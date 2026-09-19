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
      Task.fn({ id: Id.node("double"), description: "Double", run: (input) => Effect.succeed(input.value * 2) }),
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
  async ready() {
    return []
  }
  async appendEvent(event: ExecutionEvent) {
    this.events.push(event)
  }
}
