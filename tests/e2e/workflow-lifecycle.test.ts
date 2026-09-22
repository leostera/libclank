import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { createTriggerApp } from "@libclank/cloudflare"
import { createStepRegistry, Id, Task, Triggers } from "@libclank/core"
import { createLocalSchedulerDatabase } from "@libclank/local"
import { createDurableScheduler, DurableTaskScheduler } from "@libclank/scheduler"

const observer = {
  nodeStarted() {},
  nodeCompleted() {},
  nodeFailed() {},
}

describe("local durable workflow E2E", () => {
  it("executes parallel branches with independent persisted inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libclank-e2e-fanout-"))
    const database = createLocalSchedulerDatabase(join(directory, "scheduler.sqlite"))
    try {
      const trigger = Triggers.webhook<{ value: number }>({
        id: Id.trigger("fanout-input"),
        path: "/hooks/fanout-input",
      })
      const source = Task.fn({
        id: Id.node("fanout-source"),
        run: (input: { value: number }) => Effect.succeed(input.value),
      })
      const left = Task.fn({ id: Id.node("fanout-left"), run: (input: number) => Effect.succeed(`left:${input}`) })
      const right = Task.fn({ id: Id.node("fanout-right"), run: (input: number) => Effect.succeed(`right:${input}`) })
      const workflow = trigger.then(source).fanout({ left, right })
      const scheduler = await createDurableScheduler({ workflows: [workflow], database, observer })
      const response = await createTriggerApp(scheduler).fetch(
        new Request("http://e2e.test/hooks/fanout-input", { method: "POST", body: JSON.stringify({ value: 7 }) }),
      )
      expect(response.status).toBe(200)
      const payload = (await response.json()) as { runs: readonly [{ id: string; status: string }] }
      expect(payload.runs[0]?.status).toBe("completed")
      const nodes = await database.getNodes?.(Id.runFrom(payload.runs[0]!.id))
      expect(nodes?.filter((node) => node.status === "completed").map((node) => node.input)).toEqual(
        expect.arrayContaining([7]),
      )
      expect(nodes?.map((node) => node.output)).toEqual(expect.arrayContaining(["left:7", "right:7"]))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("resumes a persisted completed run without re-executing nodes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libclank-e2e-restart-"))
    const database = createLocalSchedulerDatabase(join(directory, "scheduler.sqlite"))
    try {
      const trigger = Triggers.webhook<number>({ id: Id.trigger("restart-input"), path: "/hooks/restart-input" })
      let executions = 0
      const task = Task.fn({
        id: Id.node("restart-task"),
        run: (input: number) => {
          executions += 1
          return Effect.succeed(input + 1)
        },
      })
      const workflow = trigger.then(task)
      const first = await createDurableScheduler({ workflows: [workflow], database, observer })
      const response = await createTriggerApp(first).fetch(
        new Request("http://e2e.test/hooks/restart-input", { method: "POST", body: "41" }),
      )
      const payload = (await response.json()) as { runs: readonly [{ id: string; status: string }] }
      expect(payload.runs[0]?.status).toBe("completed")
      expect(executions).toBe(1)
      await createDurableScheduler({ workflows: [workflow], database, observer })
      expect(
        await new DurableTaskScheduler({ database, tasks: createStepRegistry([workflow as never]), observer }).tick(),
      ).toBe(0)
      expect(executions).toBe(1)
      expect((await database.getRun?.(Id.runFrom(payload.runs[0]!.id)))?.status).toBe("completed")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

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
