import { Effect } from "effect"
import type { EventId, NodeId, RunId, TriggerId, WorkflowRun } from "@libclank/core"

export type ExecutionEvent =
  | { readonly type: "trigger.received"; readonly eventId: EventId; readonly runId: RunId; readonly triggerId: TriggerId; readonly payload: unknown }
  | { readonly type: "workflow.scheduled"; readonly eventId: EventId; readonly runId: RunId; readonly workflowId: NodeId }
  | { readonly type: "node.started"; readonly eventId: EventId; readonly runId: RunId; readonly nodeId: NodeId; readonly attempt: number }
  | { readonly type: "node.completed"; readonly eventId: EventId; readonly runId: RunId; readonly nodeId: NodeId; readonly output: unknown; readonly durationMs: number }
  | { readonly type: "node.failed"; readonly eventId: EventId; readonly runId: RunId; readonly nodeId: NodeId; readonly error: unknown; readonly attempt: number }
  | { readonly type: "workflow.completed"; readonly eventId: EventId; readonly runId: RunId; readonly status: WorkflowRun["status"] }

export interface ExecutionEventStore {
  append(event: ExecutionEvent): Effect.Effect<void, unknown>
  getRun(runId: RunId): Effect.Effect<readonly ExecutionEvent[], unknown>
}

export class MemoryEventStore implements ExecutionEventStore {
  private readonly events = new Map<RunId, ExecutionEvent[]>()

  append(event: ExecutionEvent): Effect.Effect<void> {
    return Effect.sync(() => {
      const events = this.events.get(event.runId) ?? []
      events.push(event)
      this.events.set(event.runId, events)
    })
  }

  getRun(runId: RunId): Effect.Effect<readonly ExecutionEvent[]> {
    return Effect.succeed(this.events.get(runId) ?? [])
  }
}
