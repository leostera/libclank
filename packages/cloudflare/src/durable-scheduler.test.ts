import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { CloudflareWorkflowRun, type DurableRunState, type DurableSql } from "./durable-scheduler.js"

describe("CloudflareWorkflowRun", () => {
  it("persists a successful node execution", async () => {
    const sql = new MemorySql()
    const state: DurableRunState = {
      storage: { sql },
      waitUntil: (promise) => {
        void promise
      },
    }
    const run = new CloudflareWorkflowRun(state, { execute: async ({ input }) => ({ ok: input }) })
    await run.start(Id.run(), "task", { value: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const node = sql.nodes.get("task")
    expect(node?.status).toBe("completed")
    expect(JSON.parse(node?.output ?? "null")).toEqual({ ok: { value: 1 } })
  })
})

class MemorySql implements DurableSql {
  readonly nodes = new Map<
    string,
    { status: string; input: string; output?: string; attempt: number; next_attempt_at?: number }
  >()
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]) {
    if (query.startsWith("CREATE")) return { toArray: () => [] as T[] }
    if (query.startsWith("SELECT node_id,input,attempt"))
      return {
        toArray: () =>
          [...this.nodes.entries()]
            .filter(([, node]) => node.status === "ready")
            .map(([node_id, node]) => ({ node_id, input: node.input, attempt: node.attempt })) as T[],
      }
    if (query.startsWith("SELECT status")) return { toArray: () => [] as T[] }
    if (query.startsWith("INSERT INTO durable_nodes")) {
      this.nodes.set(String(bindings[0]), { status: "ready", input: String(bindings[1]), attempt: 0 })
      return { toArray: () => [] as T[] }
    }
    if (query.startsWith("UPDATE durable_nodes SET status='running'")) {
      const node = this.nodes.get(String(bindings[1]))!
      node.status = "running"
      node.attempt = Number(bindings[0])
      return { toArray: () => [] as T[] }
    }
    if (query.startsWith("UPDATE durable_nodes SET status='completed'")) {
      const node = this.nodes.get(String(bindings[1]))!
      node.status = "completed"
      node.output = String(bindings[0])
      return { toArray: () => [] as T[] }
    }
    if (query.startsWith("INSERT INTO durable_events")) return { toArray: () => [] as T[] }
    throw new Error(`Unhandled SQL in test: ${query}`)
  }
}
