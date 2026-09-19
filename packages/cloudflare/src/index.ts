export * from "./durable-scheduler.js"

import { Hono } from "hono"
import { Effect } from "effect"
import type { AgentEndpoint, AgentTaskRequest, AgentTaskResponse } from "@libclank/agent"
import type { Scheduler } from "@libclank/core"

export interface CloudflareEndpointTarget {
  fetch(request: Request): Promise<Response>
}

/** Connects Task.agent to a team-owned AgentRuntime deployed as an Agents SDK DO or Worker. */
export const createAgentEndpoint = (target: CloudflareEndpointTarget, path = "/task"): AgentEndpoint => ({
  run: <Input, Output>(request: AgentTaskRequest<Input>) =>
    Effect.tryPromise(async () => {
      const response = await target.fetch(
        new Request(`https://agent.internal${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      )
      if (!response.ok) throw new Error(`Agent endpoint returned ${response.status}`)
      const result = (await response.json()) as AgentTaskResponse<Output>
      if (!result.ok) throw new Error(result.error.message)
      return result.output
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
      const runs = await scheduler.runTrigger(trigger.id, payload)
      return context.json({ triggerId: trigger.id, runs })
    })
  }
  app.get("/health", (context) => context.json({ ok: true }))
  return app
}
