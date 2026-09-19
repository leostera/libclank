import type { WorkflowManifest, WorkflowDefinitionHash } from "./manifest.js"
import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"

/** Persistence boundary shared by local SQLite and Durable Object SQLite implementations. */
export interface SchedulerDatabase {
  register(manifest: WorkflowManifest): Promise<void>
  definition(hash: WorkflowDefinitionHash): Promise<WorkflowManifest | undefined>
  createRun(run: WorkflowRunRecord): Promise<void>
  getRun(runId: WorkflowRunRecord["id"]): Promise<WorkflowRunRecord | undefined>
  putNode(instance: NodeInstanceRecord): Promise<void>
  getNode(instanceId: string): Promise<NodeInstanceRecord | undefined>
  ready(now: number): Promise<readonly NodeInstanceRecord[]>
}
