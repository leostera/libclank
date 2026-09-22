import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  Id,
  SchedulerObservers,
  Task,
  Triggers,
  createScheduler,
  type Node,
  type TriggerId,
  type WorkflowRun,
} from "@libclank/core"
import { createLocalSchedulerDatabase } from "@libclank/local"
import { createDurableScheduler, type ExecutionEvent } from "@libclank/scheduler"

export interface WorkflowFixture<Output> {
  readonly triggerId: TriggerId
  readonly input: unknown
  readonly expectedOutput: Output
  readonly workflow: Node<void, Output>
}

export interface WorkflowConformanceResult<Output> {
  readonly eager: WorkflowRun
  readonly durable: WorkflowRun
  readonly durableEvents: readonly ExecutionEvent[]
}

/**
 * Executes the same fixture through both currently-supported local execution paths.
 * Add fixture cases here before changing a behavior shared by eager and durable execution.
 */
export const runWorkflowConformance = async <Output>(
  fixture: WorkflowFixture<Output>,
): Promise<WorkflowConformanceResult<Output>> => {
  const eagerScheduler = createScheduler({ workflows: [fixture.workflow], observer: SchedulerObservers.noop })
  const eager = onlyRun(await eagerScheduler.runTrigger(fixture.triggerId, fixture.input))

  const directory = await mkdtemp(join(tmpdir(), "libclank-conformance-"))
  const database = createLocalSchedulerDatabase(join(directory, "scheduler.sqlite"))
  try {
    const durableScheduler = await createDurableScheduler({
      workflows: [fixture.workflow],
      database,
      observer: SchedulerObservers.noop,
    })
    const durable = onlyRun(await durableScheduler.runTrigger(fixture.triggerId, fixture.input))
    const durableEvents = (await database.getEvents?.(durable.id)) ?? []
    return { eager, durable, durableEvents }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Representative stable linear fixture for public-API and runtime compatibility tests. */
export const createLinearWorkflowFixture = (): WorkflowFixture<number> => {
  const trigger = Triggers.webhook<number>({ id: Id.trigger("conformance-input") })
  const increment = Task.fn({ id: Id.node("conformance-increment"), run: (value: number) => Effect.succeed(value + 1) })
  const double = Task.fn({ id: Id.node("conformance-double"), run: (value: number) => Effect.succeed(value * 2) })
  return {
    triggerId: trigger.triggers[0]!.id,
    input: 20,
    expectedOutput: 42,
    workflow: trigger.then(increment).then(double),
  }
}

function onlyRun(runs: readonly WorkflowRun[]): WorkflowRun {
  const run = runs[0]
  if (!run) throw new Error("Expected the scheduler to create one workflow run")
  return run
}
