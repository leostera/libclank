import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id, SchedulerObservers, Task, Triggers, Workflow, createScheduler } from "./index.js"

describe("identifiers", () => {
  it("constructs and parses canonical definition URIs", () => {
    const trigger = Id.trigger("summaries/url")
    const node = Id.node()

    expect(trigger).toBe("clank:trigger:summaries/url")
    expect(node).toMatch(/^clank:node:[0-9a-f-]{36}$/)
    expect(Id.parse(trigger)).toEqual({ kind: "trigger", name: "summaries/url", uri: trigger })
    expect(Id.parse(node)).toEqual({ kind: "node", name: node.slice("clank:node:".length), uri: node })
  })
})

describe("node typing", () => {
  it("maps a scalar output into the shape required by a downstream task", () => {
    const source = Task.fn<void, { outputPath: string }>({
      id: Id.node(),
      run: () => Effect.succeed({ outputPath: "summary.md" }),
    })
    const openFile = Task.effect<{ path: string }>({ id: Id.node(), run: () => Effect.void })

    source.map(({ outputPath }) => ({ path: outputPath })).tap(openFile)
  })

  it("rejects incompatible downstream input shapes", () => {
    const upstream = Task.fn<void, { outputPath: string }>({
      id: Id.node(),
      run: () => Effect.succeed({ outputPath: "summary.md" }),
    })
    const openFile = Task.effect<{ path: string }>({ id: Id.node(), run: () => Effect.void })

    // @ts-expect-error An outputPath artifact cannot satisfy a task requiring path.
    upstream.tap(openFile)
  })
})

describe("scheduler", () => {
  it("runs a workflow from a manual trigger", async () => {
    const calls: string[] = []
    const trigger = Triggers.manual({ id: Id.trigger("run") })
    const double = Task.fn<number, number>({
      id: Id.node(),
      run: (value) =>
        Effect.sync(() => {
          calls.push("double")
          return value * 2
        }),
    })
    const workflow = trigger
      .then(
        Task.fn<void, number>({
          id: Id.node(),
          run: () => Effect.succeed(21),
        }),
      )
      .then(double)

    const [result] = await createScheduler({ workflows: [workflow], observer: SchedulerObservers.noop }).runTrigger(
      trigger.triggers[0]!.id,
      undefined,
    )

    expect(result?.status).toBe("completed")
    expect(result?.output).toBe(42)
    expect(calls).toEqual(["double"])
  })

  it("fans out branches and returns named outputs", async () => {
    const trigger = Triggers.manual({ id: Id.trigger("fanout") })
    const source = trigger.then(Task.fn<void, number>({ id: Id.node(), run: () => Effect.succeed(3) }))
    const workflow = source.fanout({
      plusOne: Task.fn<number, number>({ id: Id.node(), run: (value) => Effect.succeed(value + 1) }),
      timesTwo: Task.fn<number, number>({ id: Id.node(), run: (value) => Effect.succeed(value * 2) }),
    })

    const [result] = await createScheduler({ workflows: [workflow], observer: SchedulerObservers.noop }).runTrigger(
      trigger.triggers[0]!.id,
      undefined,
    )

    expect(result?.status).toBe("completed")
    expect(result?.output).toEqual({ plusOne: 4, timesTwo: 6 })
  })

  it("maps a collection through a task", async () => {
    const trigger = Triggers.manual({ id: Id.trigger("map") })
    const numbers = trigger.then(
      Task.fn<void, readonly number[]>({ id: Id.node(), run: () => Effect.succeed([1, 2, 3]) }),
    )
    const workflow = numbers.mapEach(
      Task.fn<number, number>({ id: Id.node(), run: (value) => Effect.succeed(value * value) }),
    )

    const [result] = await createScheduler({ workflows: [workflow], observer: SchedulerObservers.noop }).runTrigger(
      trigger.triggers[0]!.id,
      undefined,
    )

    expect(result?.status).toBe("completed")
    expect(result?.output).toEqual([1, 4, 9])
  })

  it("does not run downstream work after a failure", async () => {
    const calls: string[] = []
    const trigger = Triggers.manual({ id: Id.trigger("failure") })
    const failing = trigger.then(
      Task.fn<void, never>({
        id: Id.node(),
        run: () => Effect.fail(new Error("expected failure")),
      }),
    )
    const workflow = failing.then(
      Task.effect({
        id: Id.node(),
        run: () =>
          Effect.sync(() => {
            calls.push("ran")
          }),
      }),
    )

    const [result] = await createScheduler({ workflows: [workflow], observer: SchedulerObservers.noop }).runTrigger(
      trigger.triggers[0]!.id,
      undefined,
    )

    expect(result?.status).toBe("failed")
    expect(result?.error).toMatchObject({
      name: "NodeExecutionError",
      message: expect.stringContaining("failed: expected failure"),
    })
    expect(calls).toEqual([])
  })

  it("oneOf accepts either trigger", async () => {
    const first = Triggers.manual({ id: Id.trigger("first") })
    const second = Triggers.manual({ id: Id.trigger("second") })
    const selected = Workflow.oneOf([first, second]).then(
      Task.fn<void, string>({
        id: Id.node(),
        run: () => Effect.succeed("selected"),
      }),
    )
    const scheduler = createScheduler({ workflows: [selected], observer: SchedulerObservers.noop })

    const [result] = await scheduler.runTrigger(second.triggers[0]!.id, undefined)

    expect(result?.status).toBe("completed")
    expect(result?.output).toBe("selected")
  })
})
