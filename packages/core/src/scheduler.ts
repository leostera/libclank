import { Effect } from "effect"
import { type ExecutionError, serializeExecutionError } from "./errors.js"
import { Id, type NodeId, type RunId, type TriggerId } from "./id.js"
import { type Node, type TriggerDefinition } from "./node.js"
import { notify, type SchedulerObserver } from "./observer.js"

export interface WorkflowRun {
  readonly id: RunId
  readonly workflowId: NodeId
  readonly triggerId: TriggerId
  readonly status: "completed" | "failed"
  readonly output?: unknown
  readonly error?: ExecutionError
}

export interface Scheduler<Input = void, Output = unknown> {
  readonly workflows: readonly Node<Input, Output>[]
  readonly triggers: readonly TriggerDefinition[]
  runTrigger(triggerId: TriggerId, value: unknown): Promise<WorkflowRun[]>
  run(): never
}

export const createScheduler = <Input = void, Output = unknown>(options: {
  workflows: readonly Node<Input, Output>[]
  observer: SchedulerObserver
}): Scheduler<Input, Output> => {
  const triggers = uniqueTriggers(options.workflows.flatMap((workflow) => workflow.triggers))
  return {
    workflows: options.workflows,
    triggers,
    async runTrigger(triggerId, value) {
      notify(() => options.observer.triggerReceived({ triggerId, payload: value }))
      const workflows = options.workflows.filter((workflow) =>
        workflow.triggers.some((trigger) => trigger.id === triggerId),
      )
      return Promise.all(
        workflows.map(async (workflow) => {
          const id = Id.run()
          notify(() => options.observer.workflowScheduled({ runId: id, workflowId: workflow.id }))
          try {
            const output = await Effect.runPromise(
              workflow.execute(undefined as Input, {
                triggerValues: new Map([[triggerId, value]]),
                runId: id,
                nodeId: workflow.id,
                observer: options.observer,
              }) as Effect.Effect<unknown, unknown, never>,
            )
            const run = { id, workflowId: workflow.id, triggerId, status: "completed", output } as WorkflowRun
            notify(() => options.observer.workflowCompleted({ runId: id, workflowId: workflow.id, status: run.status }))
            return run
          } catch (error) {
            const run = {
              id,
              workflowId: workflow.id,
              triggerId,
              status: "failed",
              error: serializeExecutionError(error),
            } as WorkflowRun
            notify(() => options.observer.workflowCompleted({ runId: id, workflowId: workflow.id, status: run.status }))
            return run
          }
        }),
      )
    },
    run() {
      throw new Error("No HTTP/runtime adapter configured. Use @libclank/hono or call runTrigger().")
    },
  }
}

function uniqueTriggers(triggers: readonly TriggerDefinition[]): TriggerDefinition[] {
  return [...new Map(triggers.map((trigger) => [trigger.id, trigger])).values()]
}
