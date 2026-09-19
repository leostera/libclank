import type { RunId } from "@libclank/core"
import type { WorkflowManifest } from "./manifest.js"
import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"
import type { ExecutionEvent } from "./index.js"

export interface SchedulerOperations {
  listWorkflows(): Promise<readonly WorkflowManifest[]>
  listRuns(): Promise<readonly WorkflowRunRecord[]>
  getRun(runId: RunId): Promise<WorkflowRunRecord | undefined>
  getNodes(runId: RunId): Promise<readonly NodeInstanceRecord[]>
  getEvents(runId: RunId): Promise<readonly ExecutionEvent[]>
}
