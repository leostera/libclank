import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { materializeDynamicSteps } from "./dynamic.js"
import type { SchedulerDatabase } from "./database.js"
import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"

describe("materializeDynamicSteps", () => {
  it("creates stable, independent instances for every item", async () => {
    const run: WorkflowRunRecord = {
      id: Id.run(),
      workflowDefinitionHash: "sha256:test",
      status: "running",
      input: null,
      createdAt: 0,
      updatedAt: 0,
    }
    const template = {
      id: Id.node(),
      stepId: Id.node(),
      description: "Summarize",
      version: "1",
      cache: "by-input" as const,
      dependencies: [],
      retry: { maxAttempts: 2, backoffMs: 100 },
    }
    const database = new RecordingDatabase()
    const instances = await materializeDynamicSteps({
      database,
      run,
      template,
      items: [{ url: "a" }, { url: "b" }, { url: "c" }],
    })
    expect(instances).toHaveLength(3)
    expect(new Set(instances.map((instance) => instance.id)).size).toBe(3)
    expect(instances.map((instance) => instance.input)).toEqual([{ url: "a" }, { url: "b" }, { url: "c" }])
  })
})

class RecordingDatabase implements SchedulerDatabase {
  readonly nodes: NodeInstanceRecord[] = []
  async register() {}
  async definition() {
    return undefined
  }
  async createRun() {}
  async getRun() {
    return undefined
  }
  async putNode(node: NodeInstanceRecord) {
    this.nodes.push(node)
  }
  async ready() {
    return []
  }
  async getNode() {
    return undefined
  }
}
