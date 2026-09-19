import type { NodeDefinition, TriggerDefinition, WorkflowId } from "@libclank/core"

export type WorkflowDefinitionHash = `sha256:${string}`

/** Persistable source metadata used to identify compatible task implementations on resume. */
export interface WorkflowManifest {
  readonly schemaVersion: 1
  readonly workflowId: WorkflowId
  readonly definitionHash: WorkflowDefinitionHash
  readonly tasks: readonly NodeDefinition[]
  readonly triggers: readonly PersistedTriggerDefinition[]
}

export interface WorkflowManifestSource {
  readonly workflowId: WorkflowId
  readonly tasks: readonly NodeDefinition[]
  readonly triggers?: readonly TriggerDefinition[]
}

export interface PersistedTriggerDefinition {
  readonly id: string
  readonly kind: TriggerDefinition["kind"]
  readonly path?: string
  readonly schedule?: string
}

/** Builds a stable, hashable manifest from source-defined task and trigger metadata. */
export const createWorkflowManifest = async (source: WorkflowManifestSource): Promise<WorkflowManifest> => {
  const tasks = [...source.tasks].sort((left, right) => left.id.localeCompare(right.id))
  const triggers = (source.triggers ?? [])
    .map(({ id, kind, path, schedule }) => ({
      id,
      kind,
      ...(path === undefined ? {} : { path }),
      ...(schedule === undefined ? {} : { schedule }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const canonical = JSON.stringify({ schemaVersion: 1, workflowId: source.workflowId, tasks, triggers })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource)
  const definitionHash =
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as WorkflowDefinitionHash
  return { schemaVersion: 1, workflowId: source.workflowId, definitionHash, tasks, triggers }
}
