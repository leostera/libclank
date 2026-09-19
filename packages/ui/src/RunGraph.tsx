import { Schema } from "effect"
import { useEffect, useMemo, useState } from "react"
import { Background, Controls, ReactFlow, type Edge, type Node as FlowNode } from "@xyflow/react"
import "@xyflow/react/dist/style.css"

const Run = Schema.Struct({ id: Schema.String, workflowDefinitionHash: Schema.String, status: Schema.String })
const Task = Schema.Struct({ id: Schema.String, description: Schema.String, dependencies: Schema.Array(Schema.String) })
const Trigger = Schema.Struct({ id: Schema.String, kind: Schema.String, path: Schema.optional(Schema.String) })
const Edge = Schema.Struct({ from: Schema.String, to: Schema.String, kind: Schema.String })
const Manifest = Schema.Struct({
  workflowId: Schema.String,
  definitionHash: Schema.String,
  triggers: Schema.Array(Trigger),
  tasks: Schema.Array(Task),
  edges: Schema.optional(Schema.Array(Edge)),
})
const Instance = Schema.Struct({ nodeId: Schema.String, status: Schema.String, attempt: Schema.Number })
type Run = Schema.Schema.Type<typeof Run>
type Manifest = Schema.Schema.Type<typeof Manifest>
type Instance = Schema.Schema.Type<typeof Instance>

export interface RunGraphProps {
  readonly runId: string
  readonly apiBase?: string
}

/** React Flow execution graph. It is read-only and reflects persisted node state. */
export const RunGraph = ({ runId, apiBase = "/api" }: RunGraphProps) => {
  const [run, setRun] = useState<Run>()
  const [manifest, setManifest] = useState<Manifest>()
  const [instances, setInstances] = useState<readonly Instance[]>([])
  useEffect(() => {
    const load = async () => {
      const [runValue, nodesValue, workflowsValue] = await Promise.all([
        fetch(`${apiBase}/runs/${encodeURIComponent(runId)}`).then((response) => response.json()),
        fetch(`${apiBase}/runs/${encodeURIComponent(runId)}/nodes`).then((response) => response.json()),
        fetch(`${apiBase}/workflows`).then((response) => response.json()),
      ])
      const nextRun = await Schema.decodeUnknownPromise(Run)(runValue)
      const nextInstances = await Schema.decodeUnknownPromise(Schema.Array(Instance))(nodesValue)
      const workflows = await Schema.decodeUnknownPromise(Schema.Array(Manifest))(workflowsValue)
      setRun(nextRun)
      setInstances(nextInstances)
      setManifest(workflows.find((item) => item.definitionHash === nextRun.workflowDefinitionHash))
    }
    void load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [apiBase, runId])
  const nodes = useMemo<FlowNode[]>(() => {
    if (!manifest) return []
    const triggerNodes = manifest.triggers.map((trigger) => ({
      id: `trigger:${trigger.id}`,
      data: { label: `⚡ ${trigger.kind}\n${trigger.path ?? trigger.id}` },
      style: { borderColor: "#7c3aed", whiteSpace: "pre-line" },
    }))
    const taskNodes = manifest.tasks.map((task) => {
      const instance = instances.find((item) => item.nodeId === task.id)
      return {
        id: task.id,
        data: { label: `${task.description}\n${instance?.status ?? "pending"} · attempt ${instance?.attempt ?? 0}` },
        style: { whiteSpace: "pre-line", borderColor: color(instance?.status) },
      }
    })
    const all = [...triggerNodes, ...taskNodes]
    const manifestEdges = manifest.edges ?? []
    const levels = new Map<string, number>()
    const levelOf = (id: string, visiting = new Set<string>()): number => {
      if (levels.has(id)) return levels.get(id)!
      if (visiting.has(id)) return 0
      visiting.add(id)
      const parents = manifestEdges.filter(
        (edge) => (edge.kind === "trigger" ? `trigger:${edge.from}` : edge.from) !== id && edge.to === id,
      )
      const level =
        parents.length === 0
          ? 0
          : Math.max(
              ...parents.map(
                (edge) => levelOf(edge.kind === "trigger" ? `trigger:${edge.from}` : edge.from, visiting) + 1,
              ),
            )
      levels.set(id, level)
      return level
    }
    for (const node of all) levelOf(node.id)
    const rows = new Map<number, number>()
    for (const node of all) {
      const level = levels.get(node.id) ?? 0
      rows.set(level, (rows.get(level) ?? 0) + 1)
    }
    const offsets = new Map<number, number>()
    return all.map((node) => {
      const level = levels.get(node.id) ?? 0
      const row = offsets.get(level) ?? 0
      offsets.set(level, row + 1)
      const count = rows.get(level) ?? 1
      return { ...node, position: { x: (row - (count - 1) / 2) * 320, y: level * 170 } }
    })
  }, [instances, manifest])
  const edges = useMemo<Edge[]>(
    () =>
      (manifest?.edges ?? []).map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.kind === "trigger" ? `trigger:${edge.from}` : edge.from,
        target: edge.to,
        animated: instances.find((item) => item.nodeId === edge.to)?.status === "running",
      })),
    [instances, manifest],
  )
  if (!run || !manifest) return <p>Loading run graph…</p>
  return (
    <section style={{ height: 600 }}>
      <h2>Run {run.id}</h2>
      <p>Status: {run.status}</p>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </section>
  )
}

function color(status: string | undefined): string {
  return status === "completed"
    ? "#16a34a"
    : status === "failed"
      ? "#dc2626"
      : status === "running"
        ? "#2563eb"
        : "#9ca3af"
}
