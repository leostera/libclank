import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"
import type { SchedulerDatabase } from "./database.js"
import type { WorkflowManifest } from "./manifest.js"

/** Creates durable step instances and dependency rows from a registered static manifest. */
export const materializeWorkflowRun = async (options: {
  readonly database: SchedulerDatabase
  readonly run: WorkflowRunRecord
  readonly manifest: WorkflowManifest
  readonly input: unknown
}): Promise<readonly NodeInstanceRecord[]> => {
  const instances = options.manifest.tasks.map((task) => ({
    id: `${options.run.id}:${task.stepId}`,
    runId: options.run.id,
    nodeId: task.stepId,
    status: "pending" as const,
    input: options.input,
    inputArtifacts: [],
    attempt: 0,
  }))
  for (const instance of instances) await options.database.putNode(instance)
  const instanceByStep = new Map(instances.map((instance) => [String(instance.nodeId), instance.id]))
  for (const edge of options.manifest.edges.filter((edge) => edge.kind === "dependency")) {
    const target = instanceByStep.get(edge.to)
    const dependency = instanceByStep.get(edge.from)
    if (target && dependency) await options.database.putDependency?.(options.run.id, target, dependency)
  }
  return instances
}
