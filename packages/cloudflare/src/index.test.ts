import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { AgentTaskError } from "@libclank/agent"
import { Id, retryabilityOf } from "@libclank/core"
import { createAgentEndpoint } from "./index.js"

describe("createAgentEndpoint", () => {
  it("preserves a permanent AgentRuntime failure as a typed execution error", async () => {
    const endpoint = createAgentEndpoint({
      fetch: async () => Response.json({ ok: false, error: { message: "policy denied", retryable: false } }),
    })
    const error = await Effect.runPromise(
      endpoint.run({
        version: 1,
        runId: Id.run(),
        nodeId: Id.node("agent"),
        attempt: 1,
        input: { value: 1 },
        instructions: "Do not run.",
      }),
    ).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(error).toBeInstanceOf(AgentTaskError)
    expect(retryabilityOf(error)).toBe("permanent")
  })
})
