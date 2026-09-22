import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { MemoryEventStore, type ExecutionEvent } from "./index.js"

describe("MemoryEventStore", () => {
  it("preserves event order for a run", async () => {
    const store = new MemoryEventStore()
    const runId = Id.run()
    const events: ExecutionEvent[] = [
      { type: "workflow.scheduled", eventId: Id.event(), runId, workflowId: Id.node() },
      { type: "node.started", eventId: Id.event(), runId, nodeId: Id.node(), attempt: 1 },
      { type: "node.completed", eventId: Id.event(), runId, nodeId: Id.node(), output: "ok", durationMs: 10 },
    ]

    for (const event of events) await Effect.runPromise(store.append(event))

    expect(await Effect.runPromise(store.getRun(runId))).toEqual(events)
  })

  it("keeps runs isolated", async () => {
    const store = new MemoryEventStore()
    const first = Id.run()
    const second = Id.run()
    const event: ExecutionEvent = {
      type: "workflow.completed",
      eventId: Id.event(),
      runId: first,
      status: "completed",
    }

    await Effect.runPromise(store.append(event))

    expect(await Effect.runPromise(store.getRun(first))).toHaveLength(1)
    expect(await Effect.runPromise(store.getRun(second))).toHaveLength(0)
  })
})
