import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { materializeWorkflowRun } from "./materialize.js"
import type { SchedulerDatabase } from "./database.js"
import type { WorkflowManifest } from "./manifest.js"
import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"

describe("materializeWorkflowRun", () => {
  it("persists one instance and dependency row per static step", async () => {
    const first = Id.node("first")
    const second = Id.node("second")
    const runId = Id.run()
    const manifest = {
      schemaVersion: 1,
      workflowId: Id.workflow("test"),
      definitionHash: "sha256:test",
      tasks: [definition(first), definition(second)],
      triggers: [],
      edges: [{ from: first, to: second, kind: "dependency" as const }],
    } satisfies WorkflowManifest
    const database = new RecordingDatabase()
    const run: WorkflowRunRecord = {
      id: runId,
      workflowDefinitionHash: manifest.definitionHash,
      status: "pending",
      input: {},
      createdAt: 0,
      updatedAt: 0,
    }
    const instances = await materializeWorkflowRun({ database, run, manifest, input: { value: 1 } })
    expect(instances).toHaveLength(2)
    expect(database.nodes.map((node) => node.id)).toEqual([`${runId}:${first}`, `${runId}:${second}`])
    expect(database.dependencies).toEqual([[`${runId}:${second}`, `${runId}:${first}`]])
  })
})

const definition = (id: ReturnType<typeof Id.node>) => ({
  id,
  stepId: id,
  description: id,
  version: "1",
  cache: "by-input" as const,
  dependencies: [],
  retry: { maxAttempts: 1, backoffMs: 0 },
})
class RecordingDatabase implements SchedulerDatabase {
  readonly nodes: NodeInstanceRecord[] = []
  readonly dependencies: string[][] = []
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
  async putDependency(_run: string, node: string, dependency: string) {
    this.dependencies.push([node, dependency])
  }
  async ready() {
    return []
  }
  async getNode() {
    return undefined
  }
}
