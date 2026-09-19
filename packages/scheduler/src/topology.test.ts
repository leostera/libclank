import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id, Task, Triggers } from "@libclank/core"
import { createWorkflowManifest } from "./manifest.js"

describe("workflow topology compilation", () => {
  it("includes triggers and data-flow edges for a linear workflow", async () => {
    const trigger = Triggers.webhook<{ value: number }>({ id: Id.trigger("input") })
    const task = Task.fn({
      id: Id.node("double"),
      description: "Double",
      run: (input: { value: number }) => Effect.succeed(input.value * 2),
    })
    const workflow = trigger.then(task)
    const manifest = await createWorkflowManifest({
      workflowId: Id.workflow("linear"),
      tasks: workflow.definitions,
      triggers: workflow.triggers,
    })

    expect(manifest.triggers[0]?.id).toBe(trigger.triggers[0]?.id)
    expect(manifest.tasks.map((item) => item.id)).toEqual(expect.arrayContaining([trigger.id, task.id]))
    expect(manifest.edges).toEqual(
      expect.arrayContaining([
        { from: trigger.id, to: task.id, kind: "dependency" },
        { from: trigger.triggers[0]!.id, to: trigger.id, kind: "trigger" },
      ]),
    )
  })

  it("gives reused task call sites distinct step identities", async () => {
    const source = Task.fn({ id: Id.node("source"), run: (input: number) => Effect.succeed(input) })
    const reused = Task.effect<number>({ id: Id.node("reused"), run: () => Effect.succeed(undefined) })
    const workflow = source.tap(reused).tap(reused)
    const manifest = await createWorkflowManifest({
      workflowId: Id.workflow("reuse"),
      tasks: workflow.definitions,
      triggers: workflow.triggers,
    })

    const stepIds = manifest.tasks.map((item) => item.stepId)
    expect(new Set(stepIds).size).toBe(stepIds.length)
  })
})
