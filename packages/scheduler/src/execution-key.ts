import type { ArtifactDigest } from "@libclank/artifacts"
import type { NodeDefinition } from "@libclank/core"
import type { WorkflowDefinitionHash } from "./manifest.js"

export type ExecutionKey = `sha256:${string}`

export interface ExecutionKeyInput {
  readonly workflowDefinitionHash: WorkflowDefinitionHash
  readonly task: NodeDefinition
  readonly input: unknown
  readonly inputArtifacts?: readonly ArtifactDigest[]
  /** Include agent/model/prompt/tool identity for agent task reuse. */
  readonly executor?: unknown
}

/** Stable content key for explicitly cacheable task executions. */
export const createExecutionKey = async (input: ExecutionKeyInput): Promise<ExecutionKey> => {
  const canonical = canonicalJson({
    workflowDefinitionHash: input.workflowDefinitionHash,
    task: input.task,
    input: input.input,
    inputArtifacts: [...(input.inputArtifacts ?? [])].sort(),
    executor: input.executor ?? null,
  })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical) as unknown as BufferSource)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`
  }
  throw new TypeError(`Execution key inputs must be JSON values; received ${typeof value}`)
}
