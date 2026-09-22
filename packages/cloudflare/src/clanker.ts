import { type Node, type TriggerDefinition } from "@libclank/core"

/** Minimal Run Durable Object interface required by the Worker router. */
export interface ClankerRunStub {
  fetch(request: Request): Promise<Response>
}

export interface ClankerRunNamespace {
  idFromName(name: string): unknown
  get(id: unknown): ClankerRunStub
}

/** Standard binding contract for every Clanker Worker. */
export interface ClankerEnv {
  readonly WORKFLOW_RUN: ClankerRunNamespace
}

export interface ClankerCloudflareConfig {
  /** Public status routes are rooted here. Defaults to `/runs`. */
  readonly runsPath?: string
}

export interface ClankerOptions {
  /** Workflows are activated by triggers and therefore have no direct input. */
  readonly workflows: readonly Node<void, unknown>[]
  readonly cloudflare?: ClankerCloudflareConfig
}

/**
 * Creates the Cloudflare Worker entrypoint for LibClank workflows.
 *
 * Workflow source code remains in the application; this router only accepts
 * triggers, assigns a run identity, and delegates durable execution to its
 * per-run Durable Object.
 */
export const createClanker = <Env extends ClankerEnv>(options: ClankerOptions) => {
  const triggers = uniqueTriggers(options.workflows.flatMap((workflow) => workflow.triggers))
  const runsPath = options.cloudflare?.runsPath ?? "/runs"

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url)
      const trigger = triggers.find((candidate) => candidate.path === url.pathname && request.method === "POST")
      if (trigger) {
        const input =
          trigger.kind === "manual" ? undefined : trigger.decode ? await trigger.decode(request) : await request.json()
        const workflow = options.workflows.find((candidate) =>
          candidate.triggers.some((item) => item.id === trigger.id),
        )
        if (!workflow) return Response.json({ error: "No workflow is registered for trigger" }, { status: 500 })
        const runId = crypto.randomUUID()
        const started = await env.WORKFLOW_RUN.get(env.WORKFLOW_RUN.idFromName(runId)).fetch(
          new Request("https://clanker.internal/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ runId, workflowId: workflow.id, triggerId: trigger.id, input }),
          }),
        )
        if (!started.ok) return Response.json({ error: "Unable to submit workflow run" }, { status: 502 })
        return Response.json(
          {
            runId,
            workflowId: workflow.id,
            triggerId: trigger.id,
            status: "scheduled",
            statusUrl: `${runsPath}/${runId}`,
          },
          { status: 202 },
        )
      }

      const runMatch = url.pathname.match(new RegExp(`^${escapeRegex(runsPath)}/([^/]+)(/events)?$`))
      if (request.method === "GET" && runMatch) {
        const suffix = runMatch[2] ? "/events" : "/"
        return env.WORKFLOW_RUN.get(env.WORKFLOW_RUN.idFromName(runMatch[1]!)).fetch(
          new Request(`https://clanker.internal${suffix}`),
        )
      }
      if (url.pathname === "/health") return Response.json({ ok: true })
      return new Response("Not found", { status: 404 })
    },
  }
}

function uniqueTriggers(triggers: readonly TriggerDefinition[]): readonly TriggerDefinition[] {
  return [...new Map(triggers.map((trigger) => [trigger.id, trigger])).values()]
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
