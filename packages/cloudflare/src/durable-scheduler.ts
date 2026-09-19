import type { RunId } from "@libclank/core"

export interface DurableSql {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] }
}
export interface DurableRunState {
  readonly storage: { readonly sql: DurableSql; putAlarm?(time: number | Date): Promise<void>; getAlarm?(): Promise<number | null> }
  readonly waitUntil: (promise: Promise<unknown>) => void
}
export interface DurableTaskExecutor {
  execute(input: { readonly runId: RunId; readonly nodeId: string; readonly attempt: number; readonly input: unknown }): Promise<unknown>
}

/** Durable Object-compatible persisted run coordinator. Use one instance per workflow run. */
export class CloudflareWorkflowRun {
  constructor(private readonly state: DurableRunState, private readonly executor: DurableTaskExecutor) {
    state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS durable_nodes (node_id TEXT PRIMARY KEY, status TEXT NOT NULL, input TEXT NOT NULL, output TEXT, attempt INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER, error TEXT); CREATE TABLE IF NOT EXISTS durable_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);`)
  }

  async start(runId: RunId, nodeId: string, input: unknown): Promise<void> {
    const existing = this.state.storage.sql.exec<{ status: string }>("SELECT status FROM durable_nodes WHERE node_id=?", nodeId).toArray()[0]
    if (existing) return
    this.state.storage.sql.exec("INSERT INTO durable_nodes (node_id,status,input) VALUES (?, 'ready', ?)", nodeId, JSON.stringify(input))
    this.state.waitUntil(this.tick(runId))
  }

  async tick(runId: RunId): Promise<void> {
    const rows = this.state.storage.sql.exec<{ node_id: string; input: string; attempt: number }>("SELECT node_id,input,attempt FROM durable_nodes WHERE status='ready' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)", Date.now()).toArray()
    for (const row of rows) {
      const attempt = row.attempt + 1
      this.state.storage.sql.exec("UPDATE durable_nodes SET status='running', attempt=? WHERE node_id=? AND status='ready'", attempt, row.node_id)
      try {
        const output = await this.executor.execute({ runId, nodeId: row.node_id, attempt, input: JSON.parse(row.input) })
        this.state.storage.sql.exec("UPDATE durable_nodes SET status='completed',output=? WHERE node_id=?", JSON.stringify(output), row.node_id)
        this.append("node.completed", { nodeId: row.node_id, attempt })
      } catch (error) {
        const retryAt = Date.now() + 1000 * 2 ** Math.max(0, attempt - 1)
        this.state.storage.sql.exec("UPDATE durable_nodes SET status=?,next_attempt_at=?,error=? WHERE node_id=?", attempt < 3 ? "ready" : "failed", retryAt, error instanceof Error ? error.message : String(error), row.node_id)
        this.append("node.failed", { nodeId: row.node_id, attempt, error: String(error) })
        if (attempt < 3) await this.state.storage.putAlarm?.(retryAt)
      }
    }
  }

  async alarm(runId: RunId): Promise<void> { await this.tick(runId) }

  private append(type: string, payload: unknown): void { this.state.storage.sql.exec("INSERT INTO durable_events (type,payload,created_at) VALUES (?,?,?)", type, JSON.stringify(payload), Date.now()) }
}
