import { Effect } from "effect"
import {
  Id,
  serializeExecutionError,
  type Node,
  type Scheduler,
  type SchedulerObserver,
  type TriggerDefinition,
  type WorkflowRun,
} from "@libclank/core"
import { createWorkflowManifest } from "./manifest.js"
import type { SchedulerDatabase } from "./database.js"
import type { NodeInstanceRecord } from "./run-state.js"

/** Scheduler facade that records trigger/run/node state before executing source-loaded task code. */
export const createDurableScheduler = async <Input = void, Output = unknown>(options: {
  readonly workflows: readonly Node<Input, Output>[]
  readonly database: SchedulerDatabase
  readonly observer: SchedulerObserver
}): Promise<Scheduler<Input, Output>> => {
  const manifests = new Map<string, Awaited<ReturnType<typeof createWorkflowManifest>>>()
  for (const workflow of options.workflows) {
    const manifest = await createWorkflowManifest({
      workflowId: Id.workflow(Id.name(workflow.id)),
      tasks: workflow.definitions,
      triggers: workflow.triggers,
    })
    manifests.set(workflow.id, manifest)
    await options.database.register(manifest)
  }
  const triggers = uniqueTriggers(options.workflows.flatMap((workflow) => workflow.triggers))
  return {
    workflows: options.workflows,
    triggers,
    async runTrigger(triggerId, value) {
      const matching = options.workflows.filter((workflow) =>
        workflow.triggers.some((trigger) => trigger.id === triggerId),
      )
      return Promise.all(
        matching.map(async (workflow) => {
          const runId = Id.run()
          const now = Date.now()
          const manifest = manifests.get(workflow.id)!
          await options.database.createRun({
            id: runId,
            workflowDefinitionHash: manifest.definitionHash,
            status: "running",
            input: value,
            createdAt: now,
            updatedAt: now,
          })
          await options.database.appendEvent?.({
            eventId: Id.event(),
            type: "trigger.received",
            runId,
            triggerId,
            payload: value,
          })
          await options.database.appendEvent?.({
            eventId: Id.event(),
            type: "workflow.scheduled",
            runId,
            workflowId: workflow.id,
          })
          const node: NodeInstanceRecord = {
            id: `${runId}:${workflow.id}`,
            runId,
            nodeId: workflow.id,
            status: "running",
            input: value,
            inputArtifacts: [],
            attempt: 1,
          }
          await options.database.putNode(node)
          await options.database.appendEvent?.({
            eventId: Id.event(),
            type: "node.started",
            runId,
            nodeId: workflow.id,
            attempt: 1,
          })
          try {
            const output = await Effect.runPromise(
              workflow.execute(undefined as Input, {
                triggerValues: new Map([[triggerId, value]]),
                runId,
                nodeId: workflow.id,
                observer: options.observer,
              }) as Effect.Effect<Output, unknown, never>,
            )
            await options.database.putNode({ ...node, status: "completed", output })
            await options.database.updateRun?.(runId, { status: "completed", updatedAt: Date.now() })
            await options.database.appendEvent?.({
              eventId: Id.event(),
              type: "node.completed",
              runId,
              nodeId: workflow.id,
              output,
              durationMs: Date.now() - now,
            })
            await options.database.appendEvent?.({
              eventId: Id.event(),
              type: "workflow.completed",
              runId,
              status: "completed",
            })
            return { id: runId, workflowId: workflow.id, triggerId, status: "completed", output } as WorkflowRun
          } catch (error) {
            const serialized = serializeExecutionError(error)
            await options.database.putNode({ ...node, status: "failed", error: serialized })
            await options.database.updateRun?.(runId, { status: "failed", updatedAt: Date.now() })
            await options.database.appendEvent?.({
              eventId: Id.event(),
              type: "node.failed",
              runId,
              nodeId: workflow.id,
              attempt: 1,
              error: serialized,
            })
            await options.database.appendEvent?.({
              eventId: Id.event(),
              type: "workflow.completed",
              runId,
              status: "failed",
            })
            return { id: runId, workflowId: workflow.id, triggerId, status: "failed", error: serialized } as WorkflowRun
          }
        }),
      )
    },
    run() {
      throw new Error("No HTTP/runtime adapter configured. Use createTriggerApp or call runTrigger().")
    },
  }
}

function uniqueTriggers(triggers: readonly TriggerDefinition[]): TriggerDefinition[] {
  return [...new Map(triggers.map((trigger) => [trigger.id, trigger])).values()]
}
