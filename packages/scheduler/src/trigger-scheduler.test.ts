import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id, Task, Triggers } from "@libclank/core"
import type { ExecutionEvent } from "./index.js"
import type { NodeInstanceRecord } from "./run-state.js"
import { createDurableScheduler } from "./trigger-scheduler.js"
import type { SchedulerDatabase } from "./database.js"
import type { WorkflowManifest } from "./manifest.js"
import type { WorkflowRunRecord } from "./run-state.js"

describe("createDurableScheduler", () => {
  it("persists the run lifecycle around a triggered workflow", async () => {
    const trigger = Triggers.webhook<{ value: number }>({ id: Id.trigger("test-hook") })
    const workflow = trigger.then(
      Task.fn({ id: Id.node(), description: "Double", run: (input) => Effect.succeed(input.value * 2) }),
    )
    const database = new RecordingDatabase()
    const scheduler = await createDurableScheduler({
      workflows: [workflow],
      database,
      observer: {
        triggerReceived() {},
        workflowScheduled() {},
        nodeStarted() {},
        nodeCompleted() {},
        nodeFailed() {},
        workflowCompleted() {},
      },
    })

    const [run] = await scheduler.runTrigger(trigger.triggers[0]!.id, { value: 4 })
    expect(run?.status).toBe("completed")
    expect(database.runs[0]?.status).toBe("completed")
    expect(database.events.map((event) => event.type)).toEqual([
      "trigger.received",
      "workflow.scheduled",
      "node.started",
      "node.completed",
      "node.started",
      "node.completed",
      "workflow.completed",
    ])
  })
})

class RecordingDatabase implements SchedulerDatabase {
  readonly runs: WorkflowRunRecord[] = []
  readonly nodes: NodeInstanceRecord[] = []
  readonly events: ExecutionEvent[] = []
  async register(_manifest: WorkflowManifest) {}
  async definition() {
    return undefined
  }
  async createRun(run: WorkflowRunRecord) {
    this.runs.push(run)
  }
  async updateRun(id: WorkflowRunRecord["id"], patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>) {
    const run = this.runs.find((item) => item.id === id)!
    Object.assign(run, patch)
  }
  async getRun() {
    return undefined
  }
  async putNode(node: NodeInstanceRecord) {
    const index = this.nodes.findIndex((item) => item.id === node.id)
    if (index < 0) this.nodes.push(node)
    else this.nodes[index] = node
  }
  async getNode() {
    return undefined
  }
  async getNodes() {
    return this.nodes
  }
  async ready() {
    return this.nodes.filter((node) => node.status === "ready" || node.status === "retry_wait")
  }
  async claimNode(id: string) {
    const node = this.nodes.find((item) => item.id === id)
    if (!node || (node.status !== "ready" && node.status !== "retry_wait")) return undefined
    const claimed = { ...node, status: "running" as const, attempt: node.attempt + 1 }
    await this.putNode(claimed)
    return claimed
  }
  async promoteReady() {
    for (const node of this.nodes) if (node.status === "pending") await this.putNode({ ...node, status: "ready" })
  }
  async appendEvent(event: ExecutionEvent) {
    this.events.push(event)
  }
}
