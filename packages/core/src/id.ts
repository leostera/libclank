declare const opaque: unique symbol
export type Opaque<T, Brand extends string> = T & { readonly [opaque]: Brand }
export type NodeId = Opaque<string, "NodeId">
export type TriggerId = Opaque<string, "TriggerId">
export type RunId = Opaque<string, "RunId">
export type EventId = Opaque<string, "EventId">
export type WorkflowId = Opaque<string, "WorkflowId">
export type AgentId = Opaque<string, "AgentId">
export type ArtifactId = Opaque<string, "ArtifactId">
export type DefinitionId = NodeId | TriggerId | WorkflowId | AgentId | ArtifactId
export type DefinitionKind = "node" | "trigger" | "workflow" | "agent" | "artifact"

export interface ParsedDefinitionId {
  readonly kind: DefinitionKind
  readonly name: string
  readonly uri: DefinitionId
}

/** Canonical LibClank URI construction and parsing. */
export const Id = {
  node: (value: string): NodeId => definition("node", value) as NodeId,
  trigger: (value: string): TriggerId => definition("trigger", value) as TriggerId,
  workflow: (value: string): WorkflowId => definition("workflow", value) as WorkflowId,
  agent: (value: string): AgentId => definition("agent", value) as AgentId,
  artifact: (value: string): ArtifactId => definition("artifact", value) as ArtifactId,
  nodeFromTrigger: (trigger: TriggerId): NodeId => definition("node", Id.name(trigger)) as NodeId,
  childNode: (parent: NodeId, child: string): NodeId => definition("node", `${Id.name(parent)}/${child}`) as NodeId,
  parse: (value: string): ParsedDefinitionId => parseDefinition(value),
  name: (value: DefinitionId): string => parseDefinition(value).name,
  kind: (value: DefinitionId): DefinitionKind => parseDefinition(value).kind,
  run: (): RunId => crypto.randomUUID() as RunId,
  runFrom: (value: string): RunId =>
    isUuid(value)
      ? (value as RunId)
      : (() => {
          throw new Error(`Invalid run ID: ${value}`)
        })(),
  event: (): EventId => crypto.randomUUID() as EventId,
}

function definition(kind: DefinitionKind, value: string): DefinitionId {
  if (value.startsWith("libclank://")) {
    const parsed = parseDefinition(value)
    if (parsed.kind !== kind) throw new Error(`Expected a libclank ${kind} ID, received ${parsed.kind}`)
    return parsed.uri
  }
  const name = normalizeName(value)
  return `libclank://${kind}/${name.split("/").map(encodeURIComponent).join("/")}` as DefinitionId
}

function parseDefinition(value: string): ParsedDefinitionId {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid LibClank definition ID: ${value}`)
  }
  if (url.protocol !== "libclank:" || !isDefinitionKind(url.hostname) || url.search || url.hash) {
    throw new Error(`Invalid LibClank definition ID: ${value}`)
  }
  let name: string
  try {
    name = normalizeName(url.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/"))
  } catch {
    throw new Error(`Invalid LibClank definition ID: ${value}`)
  }
  const kind = url.hostname
  return { kind, name, uri: `libclank://${kind}/${name.split("/").map(encodeURIComponent).join("/")}` as DefinitionId }
}

function isDefinitionKind(value: string): value is DefinitionKind {
  return value === "node" || value === "trigger" || value === "workflow" || value === "agent" || value === "artifact"
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeName(value: string): string {
  const segments = value.split("/").filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`LibClank definition names must contain a non-relative path: ${value}`)
  }
  return segments.join("/")
}
