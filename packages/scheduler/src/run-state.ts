import type { ArtifactRef } from "@libclank/artifacts"
import type { ExecutionError, NodeId, RunId } from "@libclank/core"
import type { ExecutionKey } from "./execution-key.js"
import type { WorkflowDefinitionHash } from "./manifest.js"

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "blocked_definition_unavailable"
export type NodeInstanceStatus = "pending" | "ready" | "running" | "retry_wait" | "completed" | "failed" | "cancelled"

/** Durable run record. Inputs and outputs are persisted values or immutable artifact references. */
export interface WorkflowRunRecord {
  readonly id: RunId
  readonly workflowDefinitionHash: WorkflowDefinitionHash
  readonly status: RunStatus
  readonly input: unknown
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NodeInstanceRecord {
  /** UUID-backed clank:node-instance identifier. */
  readonly id: string
  readonly runId: RunId
  readonly nodeId: NodeId
  readonly status: NodeInstanceStatus
  readonly input: unknown
  readonly inputArtifacts: readonly ArtifactRef[]
  readonly output?: unknown
  readonly outputArtifacts?: readonly ArtifactRef[]
  readonly executionKey?: ExecutionKey
  readonly attempt: number
  readonly nextAttemptAt?: number
  readonly leaseExpiresAt?: number
  readonly error?: ExecutionError
}

export const NodeInstanceTransitions = {
  canTransition(from: NodeInstanceStatus, to: NodeInstanceStatus): boolean {
    return (
      {
        pending: ["ready", "cancelled"],
        ready: ["running", "cancelled"],
        running: ["completed", "retry_wait", "failed", "cancelled"],
        retry_wait: ["ready", "cancelled"],
        completed: [],
        failed: [],
        cancelled: [],
      } as const
    )[from].includes(to as never)
  },
  assert(from: NodeInstanceStatus, to: NodeInstanceStatus): void {
    if (!this.canTransition(from, to)) throw new Error(`Invalid node instance transition: ${from} -> ${to}`)
  },
}
