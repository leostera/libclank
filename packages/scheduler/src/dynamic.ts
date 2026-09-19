import type { NodeInstanceRecord, WorkflowRunRecord } from "./run-state.js"
import type { SchedulerDatabase } from "./database.js"
import type { NodeDefinition } from "@libclank/core"

/** Materializes one durable step instance per collection item for a map template. */
export const materializeDynamicSteps = async (options: {
  readonly database: SchedulerDatabase
  readonly run: WorkflowRunRecord
  readonly template: NodeDefinition
  readonly items: readonly unknown[]
  readonly inputArtifacts?: readonly import("@libclank/artifacts").ArtifactRef[]
}): Promise<readonly NodeInstanceRecord[]> => {
  const instances = options.items.map((item, index) => ({
    id: `${options.run.id}:${options.template.stepId}:${itemKey(item, index)}`,
    runId: options.run.id,
    nodeId: options.template.stepId,
    status: "ready" as const,
    input: item,
    inputArtifacts: options.inputArtifacts ?? [],
    attempt: 0,
  }))
  for (const instance of instances) await options.database.putNode(instance)
  return instances
}

function itemKey(item: unknown, index: number): string {
  const value = JSON.stringify(item)
  return value === undefined ? String(index) : `${index}-${hash(value)}`
}

function hash(value: string): string {
  let result = 2166136261
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619)
  return (result >>> 0).toString(16)
}
