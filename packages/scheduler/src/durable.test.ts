import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id, Task, createTaskRegistry } from "@libclank/core"
import type { NodeInstanceRecord } from "./run-state.js"
import type { SchedulerDatabase } from "./database.js"
import { DurableTaskScheduler } from "./durable.js"

describe("DurableTaskScheduler", () => {
  it("retries a failed task from its persisted input", async () => {
    const nodeId = Id.node("retryable")
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
  constructor(public node: NodeInstanceRecord) {}
  async register() {}
  async definition() {
    return undefined
  }
  async createRun() {}
  async getRun() {
    return undefined
  }
  async putNode(node: NodeInstanceRecord) {
    this.node = node
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
  async cached() {
    return undefined
  }
}
