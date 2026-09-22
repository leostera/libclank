import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Id, Task, createTaskRegistry } from "@libclank/core"
import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"
import type { SchedulerDatabase } from "./database.js"
import { DurableTaskScheduler } from "./durable.js"
import type { ExecutionEvent } from "./index.js"

describe("DurableTaskScheduler", () => {
  it("decodes inputs and validates outputs at the execution boundary", async () => {
    const nodeId = Id.node()
    const task = Task.fn({
      id: nodeId,
      input: Schema.Struct({ value: Schema.Number }),
      output: Schema.Number,
      run: (input: { value: number }) => Effect.succeed(input.value + 1),
    })
    const node: NodeInstanceRecord = {
      id: "typed-1",
      runId: Id.run(),
      nodeId,
      status: "ready",
      input: { value: 2 },
      inputArtifacts: [],
      attempt: 0,
    }
    const database = new FakeDatabase(node)
    await new DurableTaskScheduler({ database, tasks: createTaskRegistry([task] as unknown as never[]) }).tick()
    expect(database.node.output).toBe(3)
  })

  it("reuses a completed cacheable task output for the same validated input", async () => {
    const nodeId = Id.node()
    let executions = 0
    const task = Task.fn({
      id: nodeId,
      cache: "by-input",
      run: (input: { value: number }) =>
        Effect.sync(() => {
          executions++
          return input.value * 2
        }),
    })
    const first: NodeInstanceRecord = {
      id: "cacheable-1",
      runId: Id.run(),
      nodeId,
      status: "ready",
      input: { value: 4 },
      inputArtifacts: [],
      attempt: 0,
    }
    const database = new FakeDatabase(first)
    const scheduler = new DurableTaskScheduler({ database, tasks: createTaskRegistry([task] as unknown as never[]) })

    await scheduler.tick()
    database.node = { ...first, id: "cacheable-2", status: "ready", attempt: 0 }
    await scheduler.tick()

    expect(executions).toBe(1)
    expect(database.node).toMatchObject({ status: "completed", output: 8 })
    expect(database.node.executionKey).toMatch(/^sha256:/)
    expect(database.events.map((event) => event.type)).toEqual([
      "node.started",
      "node.completed",
      "node.started",
      "node.cache_hit",
      "node.completed",
    ])
  })

  it("does not exceed the task's declared maximum attempts", async () => {
    const nodeId = Id.node()
    let executions = 0
    const task = Task.fn({
      id: nodeId,
      retry: { maxAttempts: 1, backoffMs: 0 },
      run: () =>
        Effect.sync(() => {
          executions++
          throw new Error("permanent")
        }),
    })
    const node: NodeInstanceRecord = {
      id: "single-attempt-1",
      runId: Id.run(),
      nodeId,
      status: "ready",
      input: undefined,
      inputArtifacts: [],
      attempt: 0,
    }
    const database = new FakeDatabase(node)
    const scheduler = new DurableTaskScheduler({ database, tasks: createTaskRegistry([task] as unknown as never[]) })

    await scheduler.tick()
    await scheduler.tick(Date.now() + 1)

    expect(database.node.status).toBe("failed")
    expect(executions).toBe(1)
  })

  it("does not retry an invalid task output", async () => {
    const nodeId = Id.node()
    let executions = 0
    const task = Task.fn({
      id: nodeId,
      output: Schema.Number,
      retry: { maxAttempts: 3, backoffMs: 0 },
      run: () =>
        Effect.sync(() => {
          executions++
          return "not-a-number" as unknown as number
        }),
    })
    const node: NodeInstanceRecord = {
      id: "invalid-output-1",
      runId: Id.run(),
      nodeId,
      status: "ready",
      input: undefined,
      inputArtifacts: [],
      attempt: 0,
    }
    const database = new FakeDatabase(node)
    const scheduler = new DurableTaskScheduler({ database, tasks: createTaskRegistry([task] as unknown as never[]) })

    await scheduler.tick()
    await scheduler.tick(Date.now() + 1)

    expect(database.node.status).toBe("failed")
    expect(database.node.error?.retryability).toBe("permanent")
    expect(executions).toBe(1)
  })

  it("retries a failed task from its persisted input", async () => {
    const nodeId = Id.node()
    let executions = 0
    const task = Task.fn({
      id: nodeId,
      retry: { maxAttempts: 2, backoffMs: 0 },
      run: (input: { value: number }) =>
        Effect.try({
          try: () => {
            executions++
            if (executions === 1) throw new Error("temporary")
            return input.value + 1
          },
          catch: (error) => error,
        }),
    })
    const node: NodeInstanceRecord = {
      id: "node-1",
      runId: Id.run(),
      nodeId,
      status: "ready",
      input: { value: 2 },
      inputArtifacts: [],
      attempt: 0,
    }
    const database = new FakeDatabase(node)
    const scheduler = new DurableTaskScheduler({ database, tasks: createTaskRegistry([task] as unknown as never[]) })

    await scheduler.tick()
    expect(database.node.status).toBe("retry_wait")
    await scheduler.tick(Date.now() + 1)
    expect(database.node.status).toBe("completed")
    expect(database.node.output).toBe(3)
    expect(executions).toBe(2)
  })
})

class FakeDatabase implements SchedulerDatabase {
  readonly events: ExecutionEvent[] = []
  private cachedNode: NodeInstanceRecord | undefined
  constructor(public node: NodeInstanceRecord) {}
  async register() {}
  async definition() {
    return undefined
  }
  async createRun() {}
  async getRun(): Promise<WorkflowRunRecord> {
    return {
      id: this.node.runId,
      workflowDefinitionHash: "sha256:test" as WorkflowRunRecord["workflowDefinitionHash"],
      status: "running",
      input: this.node.input,
      createdAt: 0,
      updatedAt: 0,
    }
  }
  async putNode(node: NodeInstanceRecord) {
    this.node = node
    if (node.status === "completed" && node.executionKey) this.cachedNode = node
  }
  async getNode() {
    return this.node
  }
  async ready() {
    return this.node.status === "ready" || this.node.status === "retry_wait" ? [this.node] : []
  }
  async claimNode() {
    if (this.node.status !== "ready" && this.node.status !== "retry_wait") return undefined
    this.node = { ...this.node, status: "running", attempt: this.node.attempt + 1 }
    return this.node
  }
  async cached(executionKey: string) {
    return this.cachedNode?.executionKey === executionKey ? this.cachedNode : undefined
  }
  async appendEvent(event: ExecutionEvent) {
    this.events.push(event)
  }
}
