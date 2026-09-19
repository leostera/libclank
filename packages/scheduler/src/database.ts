import type { WorkflowManifest, WorkflowDefinitionHash } from "./manifest.js"
import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"

/** Persistence boundary shared by local SQLite and Durable Object SQLite implementations. */
export interface SchedulerDatabase {
  register(manifest: WorkflowManifest): Promise<void>
  definition(hash: WorkflowDefinitionHash): Promise<WorkflowManifest | undefined>
  createRun(run: WorkflowRunRecord): Promise<void>
  updateRun?(
    runId: WorkflowRunRecord["id"],
    patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>,
  ): Promise<void>
  getRun(runId: WorkflowRunRecord["id"]): Promise<WorkflowRunRecord | undefined>
  putNode(instance: NodeInstanceRecord): Promise<void>
  getNode(instanceId: string): Promise<NodeInstanceRecord | undefined>
  ready(now: number): Promise<readonly NodeInstanceRecord[]>
  cached?(executionKey: string): Promise<NodeInstanceRecord | undefined>
  claimNode?(instanceId: string, leaseMs: number): Promise<NodeInstanceRecord | undefined>
  appendEvent?(event: import("./index.js").ExecutionEvent): Promise<void>
  recoverExpired?(now: number): Promise<void>
  listWorkflows?(): Promise<readonly import("./manifest.js").WorkflowManifest[]>
  listRuns?(): Promise<readonly WorkflowRunRecord[]>
  getNodes?(runId: WorkflowRunRecord["id"]): Promise<readonly NodeInstanceRecord[]>
  getEvents?(runId: WorkflowRunRecord["id"]): Promise<readonly import("./index.js").ExecutionEvent[]>
}
