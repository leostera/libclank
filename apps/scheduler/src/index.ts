import { Id, type RunId } from "@libclank/core"
import { AGENT_TASK_PROTOCOL_VERSION, type AgentTaskRequest, type AgentTaskResponse } from "@libclank/agent"

interface Env {
  AGENT: Fetcher
  WORKFLOW_RUN: DurableObjectNamespace
}

type RunStatus = "scheduled" | "running" | "completed" | "failed"
type RunRecord = {
  readonly runId: RunId
  readonly status: RunStatus
  readonly output?: unknown
  readonly error?: string
}
type EventRow = {
  readonly sequence: number
  readonly type: string
  readonly payload: string
  readonly created_at: number
}

const workflowId = Id.workflow("review-open-mrs")
const agentNodeId = Id.node()

/** One durable, SQLite-backed coordinator for exactly one workflow run. */
export class WorkflowRun implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/start") {
      const { runId, input } = (await request.json()) as { runId: RunId; input: unknown }
      return this.start(runId, input)
    }
    if (request.method === "GET" && url.pathname === "/events") return Response.json(this.events())
    if (request.method === "GET" && url.pathname === "/") return Response.json(this.run())
    return new Response("Not found", { status: 404 })
  }

  private async start(runId: RunId, input: unknown): Promise<Response> {
    const existing = this.run()
    if (existing) return Response.json(existing)
    this.ctx.storage.sql.exec("INSERT INTO runs (run_id, status) VALUES (?, ?)", runId, "scheduled")
    this.append("trigger.received", { triggerId: Id.trigger("review-open-mrs"), payload: input })
    this.append("workflow.scheduled", { workflowId })
    this.ctx.waitUntil(this.execute(runId, input))
    return Response.json({ runId, status: "scheduled" satisfies RunStatus })
  }

  private async execute(runId: RunId, input: unknown): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE runs SET status = ? WHERE run_id = ?", "running", runId)
    this.append("node.started", { nodeId: agentNodeId, attempt: 1 })
    const task: AgentTaskRequest<unknown> = {
      version: AGENT_TASK_PROTOCOL_VERSION,
      runId,
      nodeId: agentNodeId,
      nodeInstanceId: `${runId}:${agentNodeId}`,
      executionToken: `${runId}:${agentNodeId}:1`,
      attempt: 1,
      input,
      instructions: "Review the supplied merge-request payload using the team's configured tools.",
      executorIdentity: { protocolVersion: AGENT_TASK_PROTOCOL_VERSION, deployment: "scheduler-app" },
    }

    try {
      const response = await this.env.AGENT.fetch(
        new Request("https://agent.internal/task", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(task),
        }),
      )
      if (!response.ok) throw new Error(`Agent endpoint returned ${response.status}`)
      const result = (await response.json()) as AgentTaskResponse<unknown>
      if (!result.ok) throw new Error(result.error.message)
      this.ctx.storage.sql.exec(
        "UPDATE runs SET status = ?, output = ? WHERE run_id = ?",
        "completed",
        JSON.stringify(result.output),
        runId,
      )
      this.append("node.completed", { nodeId: agentNodeId, attempt: 1, output: result.output })
      this.append("workflow.completed", { status: "completed" })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.storage.sql.exec("UPDATE runs SET status = ?, error = ? WHERE run_id = ?", "failed", message, runId)
      this.append("node.failed", { nodeId: agentNodeId, attempt: 1, error: message })
      this.append("workflow.completed", { status: "failed" })
    }
  }

  private run(): RunRecord | undefined {
    const row = this.ctx.storage.sql
      .exec<{ run_id: string; status: RunStatus; output: string | null; error: string | null }>(
        "SELECT run_id, status, output, error FROM runs LIMIT 1",
      )
      .toArray()[0]
    return (
      row && {
        runId: row.run_id as RunId,
        status: row.status,
        ...(row.output === null ? {} : { output: JSON.parse(row.output) }),
        ...(row.error === null ? {} : { error: row.error }),
      }
    )
  }

  private events(): readonly {
    readonly sequence: number
    readonly type: string
    readonly payload: unknown
    readonly createdAt: number
  }[] {
    return this.ctx.storage.sql
      .exec<EventRow>("SELECT sequence, type, payload, created_at FROM events ORDER BY sequence")
      .toArray()
      .map((event) => ({
        sequence: event.sequence,
        type: event.type,
        payload: JSON.parse(event.payload),
        createdAt: event.created_at,
      }))
  }

  private append(type: string, payload: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)",
      type,
      JSON.stringify(payload),
      Date.now(),
    )
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/run/review-open-mrs") {
      const runId = request.headers.get("idempotency-key") ?? crypto.randomUUID()
      if (!isUuid(runId)) return Response.json({ error: "idempotency-key must be a UUID" }, { status: 400 })
      const stub = env.WORKFLOW_RUN.get(env.WORKFLOW_RUN.idFromName(runId))
      const payload = request.headers.get("content-type")?.includes("application/json")
        ? await request.json()
        : undefined
      const created = await stub.fetch(
        new Request("https://run.internal/start", {
          method: "POST",
          body: JSON.stringify({ runId, input: payload }),
        }),
      )
      return new Response(created.body, { status: 202, headers: { "content-type": "application/json" } })
    }
    const match = url.pathname.match(/^\/runs\/([^/]+)(\/events)?$/)
    if (request.method === "GET" && match) {
      const stub = env.WORKFLOW_RUN.get(env.WORKFLOW_RUN.idFromName(match[1]!))
      return stub.fetch(`https://run.internal${match[2] ? "/events" : "/"}`)
    }
    if (url.pathname === "/health") return Response.json({ ok: true })
    return new Response("Not found", { status: 404 })
  },
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
