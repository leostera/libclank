import { Node, type EffectNode, type NodeDefinition, type NodeFunction, type RuntimeSchema } from "./node.js"
import { Id, type NodeId, type TaskId } from "./id.js"

export type Task<Input, Output> = Node<Input, Output>
export type TaskOptions<Input, Output> = {
  readonly id: TaskId | NodeId
  readonly run: NodeFunction<Input, Output>
  readonly description?: string
  readonly version?: string
  /** Only use `by-input` for work with reusable immutable outputs. */
  readonly cache?: NodeDefinition["cache"]
  /** Stable implementation identity included in cache keys for cacheable work. */
  readonly executor?: NodeDefinition["executor"]
  readonly retry?: NodeDefinition["retry"]
  readonly input?: RuntimeSchema<Input>
  readonly output?: RuntimeSchema<Output>
}

export const Task = {
  fn<Input, Output>(options: TaskOptions<Input, Output>): Task<Input, Output> {
    const nodeId = graphNodeId(options.id)
    return new Node(nodeId, options.run, [], true, definition(options, nodeId), [], [], options.input, options.output)
  },

  effect<Input>(options: TaskOptions<Input, void>): EffectNode<Input> {
    const nodeId = graphNodeId(options.id)
    return new Node(nodeId, options.run, [], true, definition(options, nodeId), [], [], options.input, options.output)
  },
}

/** Resolves persisted task IDs back to source-loaded implementations during retry. */
export interface TaskRegistry {
  get(id: NodeId): Node<unknown, unknown> | undefined
  definitions(): readonly NodeDefinition[]
}

export const createStepRegistry = (workflows: readonly Node<unknown, unknown>[]): TaskRegistry => {
  const byStep = new Map(
    workflows.flatMap((workflow) =>
      workflow.implementations.map((implementation) => [implementation.stepId, implementation.node] as const),
    ),
  )
  return { get: (id) => byStep.get(id), definitions: () => workflows.flatMap((workflow) => workflow.definitions) }
}

export const createTaskRegistry = (tasks: readonly Node<unknown, unknown>[]): TaskRegistry => {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return {
    get: (id) => byId.get(id),
    definitions: () => [...byId.values()].map((task) => task.definition),
  }
}

function definition<Input, Output>(options: TaskOptions<Input, Output>, nodeId: NodeId): NodeDefinition {
  const taskId = normalizeTaskId(options.id)
  return {
    id: nodeId,
    stepId: nodeId,
    taskId,
    description: options.description ?? Id.name(taskId),
    version: options.version ?? "1",
    cache: options.cache ?? "never",
    ...(options.executor === undefined ? {} : { executor: options.executor }),
    dependencies: [],
    retry: options.retry ?? { maxAttempts: 1, backoffMs: 1000 },
  }
}

function graphNodeId(id: TaskId | NodeId): NodeId {
  return Id.parse(id).kind === "node" ? (id as NodeId) : Id.node()
}

function normalizeTaskId(id: TaskId | NodeId): TaskId {
  return Id.parse(id).kind === "task" ? (id as TaskId) : Id.task(Id.name(id))
}
