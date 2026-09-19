import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { createTriggerApp } from "@libclank/cloudflare"
import { Id, Task, Triggers } from "@libclank/core"
import { createLocalSchedulerDatabase } from "@libclank/local"
import { createDurableScheduler } from "@libclank/scheduler"

const observer = {
  nodeStarted() {},
  nodeCompleted() {},
  nodeFailed() {},
}

describe("local durable workflow E2E", () => {
  it("accepts a webhook and persists the complete run lifecycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libclank-e2e-"))
    const database = createLocalSchedulerDatabase(join(directory, "scheduler.sqlite"))
    try {
      const trigger = Triggers.webhook<{ value: number }>({
        id: Id.trigger("e2e-input"),
        path: "/hooks/e2e-input",
      })
      const double = Task.fn({
        id: Id.node("e2e-double"),
        run: (input: { value: number }) => Effect.succeed({ value: input.value * 2 }),
      })
      const format = Task.fn({
        id: Id.node("e2e-format"),
        run: (input: { value: number }) => Effect.succeed(`result:${input.value}`),
      })
      const workflow = trigger.then(double).then(format)
      const scheduler = await createDurableScheduler({ workflows: [workflow], database, observer })
      const app = createTriggerApp(scheduler)

      const response = await app.fetch(
        new Request("http://e2e.test/hooks/e2e-input", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: 21 }),
        }),
      )
      expect(response.status).toBe(200)
      const payload = (await response.json()) as { runs: readonly [{ id: string; status: string; output: string }] }
      expect(payload.runs[0]).toMatchObject({ status: "completed", output: "result:42" })

      const runId = Id.runFrom(payload.runs[0]!.id)
      const run = await database.getRun?.(runId)
      const nodes = await database.getNodes?.(runId)
      const events = await database.getEvents?.(runId)
      expect(run?.status).toBe("completed")
      expect(nodes?.filter((node) => node.status === "completed")).toHaveLength(3)
      expect(nodes?.map((node) => node.output)).toEqual(expect.arrayContaining([{ value: 42 }, "result:42"]))
      expect(events?.map((event) => event.type)).toEqual([
        "trigger.received",
        "workflow.scheduled",
        "node.started",
        "node.completed",
        "node.started",
        "node.completed",
        "node.started",
        "node.completed",
        "workflow.completed",
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
