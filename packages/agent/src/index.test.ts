import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { Task, type AgentTaskRequest } from "./index.js"

describe("Task.agent", () => {
  it("forwards the durable scheduler attempt and declared retry policy", async () => {
    let request: AgentTaskRequest<number> | undefined
    const task = Task.agent<number, string>({
      id: Id.node("agent-attempt"),
      instructions: "Summarize the input.",
      retry: { maxAttempts: 2, backoffMs: 25 },
      endpoint: {
        identity: { deployment: "test-agent-v1" },
        run: <Input, Output>(value: AgentTaskRequest<Input>) =>
          Effect.sync(() => {
            request = value as AgentTaskRequest<number>
            return "ok" as Output
          }),
      },
    })

    const output = await Effect.runPromise(
      task.execute(7, {
        runId: Id.run(),
        nodeId: task.id,
        nodeInstanceId: "run:agent-attempt",
        attempt: 2,
        triggerValues: new Map(),
      }),
    )

    expect(output).toBe("ok")
    expect(request).toMatchObject({
      attempt: 2,
      input: 7,
      nodeInstanceId: "run:agent-attempt",
      executionToken: expect.stringMatching(/:run:agent-attempt:2$/),
    })
    expect(task.definition.retry).toEqual({ maxAttempts: 2, backoffMs: 25 })
    expect(task.definition.executor).toEqual({
      protocolVersion: 1,
      endpoint: { deployment: "test-agent-v1" },
      instructions: "Summarize the input.",
      model: null,
      skills: [],
    })
  })
})
