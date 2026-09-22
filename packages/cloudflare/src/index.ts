export * from "./durable-scheduler.js"

import { Hono } from "hono"
import { Effect } from "effect"
import { AgentTaskError, type AgentEndpoint, type AgentTaskRequest, type AgentTaskResponse } from "@libclank/agent"
import type { Scheduler } from "@libclank/core"

export interface CloudflareEndpointTarget {
  fetch(request: Request): Promise<Response>
}

/** Connects Task.agent to a team-owned AgentRuntime deployed as an Agents SDK DO or Worker. */
export const createAgentEndpoint = (
  target: CloudflareEndpointTarget,
  path = "/task",
  identity: unknown = { transport: "cloudflare-service-binding", path },
): AgentEndpoint => ({
  identity,
  run: <Input, Output>(request: AgentTaskRequest<Input>) =>
    Effect.tryPromise({
      try: async () => {
        const response = await target.fetch(
          new Request(`https://agent.internal${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          }),
        )
        if (!response.ok) throw new Error(`Agent endpoint returned ${response.status}`)
        const result = (await response.json()) as AgentTaskResponse<Output>
        if (!result.ok) throw new AgentTaskError(result.error.message, result.error.retryable)
        return result.output
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
})

export const createTriggerApp = (scheduler: Scheduler): Hono => {
  const app = new Hono()
  for (const trigger of scheduler.triggers) {
    if (!trigger.path) continue
    app.post(trigger.path, async (context) => {
      const payload =
        trigger.kind === "manual"
          ? undefined
          : trigger.decode
            ? await trigger.decode(context.req.raw)
            : await context.req.json()
      if (scheduler.submitTrigger) {
        const runs = await scheduler.submitTrigger(trigger.id, payload)
        return context.json({ triggerId: trigger.id, runs }, 202)
      }
      const runs = await scheduler.runTrigger(trigger.id, payload)
      return context.json({ triggerId: trigger.id, runs })
    })
  }
  app.get("/health", (context) => context.json({ ok: true }))
  return app
}
