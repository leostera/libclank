import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const runId = "018f6b8e-4a87-7c23-9d0b-1f5a2b3c4d5e"

describe("WorkflowRun", () => {
  it("accepts a trigger, dispatches an agent task, and persists its trace", async () => {
    const created = await SELF.fetch("https://scheduler.test/run/review-open-mrs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": runId },
      body: JSON.stringify({ mergeRequest: 42 }),
    })

    expect(created.status).toBe(202)
    expect(await created.json()).toMatchObject({ runId, status: "scheduled" })

    const run = await eventually(
      async () => {
        const response = await SELF.fetch(`https://scheduler.test/runs/${runId}`)
        return (await response.json()) as { status: string; output?: unknown }
      },
      (value) => value.status === "completed",
    )
    expect(run.output).toEqual({ mergeRequest: 42 })

    const events = (await (await SELF.fetch(`https://scheduler.test/runs/${runId}/events`)).json()) as {
      type: string
    }[]
    expect(events.map((event) => event.type)).toEqual([
      "trigger.received",
      "workflow.scheduled",
      "node.started",
      "node.completed",
      "workflow.completed",
    ])
  })

  it("uses the idempotency key as the durable run identity", async () => {
    const response = await SELF.fetch("https://scheduler.test/run/review-open-mrs", {
      method: "POST",
      headers: { "idempotency-key": runId },
    })
    expect(await response.json()).toMatchObject({ runId })
  })
})

async function eventually<T>(get: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const value = await get()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Workflow run did not complete")
}
