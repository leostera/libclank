import { Id, type NodeDefinition, type TriggerDefinition, type TriggerId, type WorkflowId } from "@libclank/core"

export type WorkflowDefinitionHash = `sha256:${string}`

/** Persistable source metadata used to identify compatible task implementations on resume. */
export interface WorkflowManifest {
  readonly schemaVersion: 1
  readonly workflowId: WorkflowId
  readonly definitionHash: WorkflowDefinitionHash
  readonly tasks: readonly NodeDefinition[]
  readonly triggers: readonly PersistedTriggerDefinition[]
  readonly edges: readonly WorkflowManifestEdge[]
}

export interface WorkflowManifestEdge {
  readonly from: string
  readonly to: string
  readonly kind: "dependency" | "trigger"
}

export interface WorkflowManifestSource {
  readonly workflowId: WorkflowId
  readonly tasks: readonly NodeDefinition[]
  readonly triggers?: readonly TriggerDefinition[]
}

export interface PersistedTriggerDefinition {
  readonly id: TriggerId
  readonly kind: TriggerDefinition["kind"]
  readonly path?: string
  readonly schedule?: string
}

function isComposition(id: string): boolean {
  return /\/(then|tap|map|map-each|forEach|fanout)$/.test(id)
}

function compositionEdges(tasks: readonly NodeDefinition[]): WorkflowManifestEdge[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const output = (id: string): string => {
    const task = byId.get(Id.node(id))
    return task && /(then|tap)$/.test(id) && task.dependencies[1] ? output(task.dependencies[1]) : id
  }
  const input = (id: string): string => {
    const task = byId.get(Id.node(id))
    return task && /(then|tap)$/.test(id) && task.dependencies[0] ? input(task.dependencies[0]) : id
  }
  return tasks.flatMap((task) => {
    if ((task.id.endsWith("/then") || task.id.endsWith("/tap")) && task.dependencies[0] && task.dependencies[1])
      return [{ from: input(task.dependencies[0]), to: output(task.dependencies[1]), kind: "dependency" as const }]
    if (task.id.endsWith("/fanout") && task.dependencies[0])
      return task.dependencies
        .slice(1)
        .map((branch) => ({ from: output(task.dependencies[0]!), to: input(branch), kind: "dependency" as const }))
    return []
  })
}

/** Builds a stable, hashable manifest from source-defined task and trigger metadata. */
export const createWorkflowManifest = async (source: WorkflowManifestSource): Promise<WorkflowManifest> => {
  const allTasks = [...new Map(source.tasks.map((task) => [task.stepId, task])).values()]
  const tasks = allTasks
    .filter((task) => !isComposition(task.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  const triggers = (source.triggers ?? [])
    .map(({ id, kind, path, schedule }) => ({
      id,
      kind,
      ...(path === undefined ? {} : { path }),
      ...(schedule === undefined ? {} : { schedule }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const edges: WorkflowManifestEdge[] = [
    ...compositionEdges(allTasks),
    ...triggers.map((trigger) => ({ from: trigger.id, to: Id.nodeFromTrigger(trigger.id), kind: "trigger" as const })),
  ]
  const canonical = JSON.stringify({ schemaVersion: 1, workflowId: source.workflowId, tasks, triggers, edges })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource)
  const definitionHash =
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as WorkflowDefinitionHash
  return { schemaVersion: 1, workflowId: source.workflowId, definitionHash, tasks, triggers, edges }
}
