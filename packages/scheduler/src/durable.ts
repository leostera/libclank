import { Effect } from "effect"
import { Id, serializeExecutionError, type NodeId, type RunId, type SchedulerObserver } from "@libclank/core"
import type { SchedulerDatabase } from "./database.js"
import type { NodeInstanceRecord } from "./run-state.js"
import type { TaskRegistry } from "@libclank/core"

export interface RetryPolicy {
  readonly maxAttempts: number
  readonly backoffMs: (attempt: number) => number
}

/** Durable local/DO-compatible execution loop. The database, not the call stack, is authoritative. */
export class DurableTaskScheduler {
  constructor(
    private readonly options: {
      readonly database: SchedulerDatabase
      readonly tasks: TaskRegistry
      readonly observer?: SchedulerObserver
      readonly retry?: RetryPolicy
      readonly leaseMs?: number
      readonly triggerValues?: ReadonlyMap<import("@libclank/core").TriggerId, unknown>
    },
  ) {}

  async recover(now = Date.now()): Promise<void> {
    await this.options.database.recoverExpired?.(now)
  }

  async tick(now = Date.now()): Promise<number> {
    const nodes = await this.options.database.ready(now)
    let completed = 0
    for (const candidate of nodes) {
      const node = await this.options.database.claimNode?.(candidate.id, this.options.leaseMs ?? 60_000)
      if (!node) continue
      await this.options.database.appendEvent?.({
        eventId: Id.event(),
        type: "node.started",
        runId: node.runId,
        nodeId: node.nodeId,
        attempt: node.attempt,
      })
      await this.execute(node)
      completed++
    }
    return completed
  }

  private async execute(node: NodeInstanceRecord): Promise<void> {
    if (node.executionKey) {
      const cached = await this.options.database.cached?.(node.executionKey)
      if (cached) {
        const { leaseExpiresAt: _lease, ...reused } = node
        await this.options.database.putNode({
          ...reused,
          status: "completed",
          ...(cached.output === undefined ? {} : { output: cached.output }),
          ...(cached.outputArtifacts === undefined ? {} : { outputArtifacts: cached.outputArtifacts }),
        })
        return
      }
    }
    const task = this.options.tasks.get(node.nodeId)
    if (!task) {
      await this.options.database.putNode({
        ...node,
        status: "failed",
        error: serializeExecutionError(new Error(`Task ${node.nodeId} is not registered in this deployment`)),
      })
      return
    }
    try {
      const output = await Effect.runPromise(
        task.execute(node.input, {
          runId: node.runId,
          nodeId: node.nodeId,
          triggerValues: this.options.triggerValues ?? new Map(),
          ...(this.options.observer === undefined ? {} : { observer: this.options.observer }),
        }) as Effect.Effect<unknown, unknown, never>,
      )
      const { leaseExpiresAt: _lease, error: _error, nextAttemptAt: _next, ...completed } = node
      await this.options.database.putNode({ ...completed, status: "completed", output })
      await this.options.database.appendEvent?.({
        eventId: Id.event(),
        type: "node.completed",
        runId: node.runId,
        nodeId: node.nodeId,
        output,
        durationMs: 0,
      })
      await this.options.database.promoteReady?.(node.runId)
    } catch (error) {
      const retry = this.options.retry ?? { maxAttempts: 3, backoffMs: (attempt: number) => 1000 * 2 ** (attempt - 1) }
      const next = node.attempt < retry.maxAttempts
      const { leaseExpiresAt: _lease, output: _output, outputArtifacts: _outputArtifacts, ...failed } = node
      await this.options.database.putNode({
        ...failed,
        status: next ? "retry_wait" : "failed",
        ...(next ? { nextAttemptAt: Date.now() + retry.backoffMs(node.attempt) } : {}),
        error: serializeExecutionError(error),
      })
      await this.options.database.appendEvent?.({
        eventId: Id.event(),
        type: "node.failed",
        runId: node.runId,
        nodeId: node.nodeId,
        attempt: node.attempt,
        error: serializeExecutionError(error),
      })
    }
  }
}

export interface DurableNodeInput {
  readonly runId: RunId
  readonly nodeId: NodeId
  readonly input: unknown
}
