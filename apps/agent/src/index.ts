import { Agent } from "agents"
import type { AgentTaskRequest, AgentTaskResponse } from "@libclank/agent"

export interface Env {
  LIBCLANK_AGENT: DurableObjectNamespace
}

/**
 * Team-owned AgentRuntime. Replace executeTask with model, MCP, tool, and
 * policy logic; the `/task` wire contract remains owned by LibClank.
 */
export class LibclankAgent extends Agent<Env> {
  override initialState = {}

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/task") {
      return new Response("Not found", { status: 404 })
    }

    const task = (await request.json()) as AgentTaskRequest<unknown>
    if (task.version !== 1 || !task.runId || !task.nodeId || typeof task.instructions !== "string") {
      return Response.json(
        { ok: false, error: { message: "Invalid AgentTaskRequest", retryable: false } } satisfies AgentTaskResponse,
        { status: 400 },
      )
    }

    return Response.json(await this.executeTask(task))
  }

  /** Deterministic placeholder used by the deployment slice and emulator tests. */
  protected async executeTask(task: AgentTaskRequest<unknown>): Promise<AgentTaskResponse<unknown>> {
    if (isFailureInput(task.input)) {
      return { ok: false, error: { message: "Scripted agent failure", retryable: false } }
    }
    return { ok: true, output: task.input }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.LIBCLANK_AGENT.idFromName("default")
    return env.LIBCLANK_AGENT.get(id).fetch(request)
  },
}

function isFailureInput(input: unknown): boolean {
  return typeof input === "object" && input !== null && "fail" in input && (input as { fail?: unknown }).fail === true
}
