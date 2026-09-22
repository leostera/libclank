import { Effect } from "effect"
import {
  ExecutionFailure,
  Task as CoreTask,
  type ExecutionContext,
  type NodeDefinition,
  type NodeId,
  type NodeRun,
  type RunId,
  type Task as TaskNode,
} from "@libclank/core"

export const AGENT_TASK_PROTOCOL_VERSION = 1 as const

/** Request sent by the scheduler to a team-owned AgentRuntime. */
export interface AgentTaskRequest<Input = unknown> {
  readonly version: typeof AGENT_TASK_PROTOCOL_VERSION
  readonly runId: RunId
  readonly nodeId: NodeId
  /** Unique persisted instance of this task within the workflow run. */
  readonly nodeInstanceId: string
  /** Stable at-least-once execution identity for this exact attempt. */
  readonly executionToken: string
  readonly attempt: number
  readonly input: Input
  readonly instructions: string
  /** Cache and deployment identity for the executor selected by the workflow. */
  readonly executorIdentity: unknown
  readonly model?: string
  readonly skills?: readonly string[]
}

export type AgentTaskResponse<Output = unknown> =
  | { readonly ok: true; readonly output: Output }
  | { readonly ok: false; readonly error: { readonly message: string; readonly retryable: boolean } }

/** A protocol failure returned by a team-owned AgentRuntime. */
export class AgentTaskError extends ExecutionFailure {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message, retryable ? "retryable" : "permanent")
    this.name = "AgentTaskError"
  }
}

/** Server-side implementation owned and deployed by the application team. */
export interface AgentRuntime {
  execute<Input, Output>(request: AgentTaskRequest<Input>): NodeRun<AgentTaskResponse<Output>>
}

/** Client-side handle used by the scheduler to reach an AgentRuntime. */
export interface AgentEndpoint {
  /** Stable deployment/transport identity included in cacheable Agent task keys. */
  readonly identity?: unknown
  run<Input, Output>(request: AgentTaskRequest<Input>): NodeRun<Output>
}

export const Task = {
  ...CoreTask,

  agent<Input, Output>(options: {
    id: NodeId
    instructions: string
    endpoint: AgentEndpoint
    model?: string
    skills?: readonly string[]
    description?: string
    version?: string
    /** Agents cache immutable outputs by input unless explicitly disabled. */
    cache?: NodeDefinition["cache"]
    retry?: NodeDefinition["retry"]
    /** Adds application-owned model, tool, or tenant identity to cache keys. */
    executor?: NodeDefinition["executor"]
  }): TaskNode<Input, Output> {
    const executorIdentity = {
      protocolVersion: AGENT_TASK_PROTOCOL_VERSION,
      endpoint: options.endpoint.identity ?? null,
      instructions: options.instructions,
      model: options.model ?? null,
      skills: [...(options.skills ?? [])].sort(),
      ...(options.executor === undefined ? {} : { application: options.executor }),
    }
    return CoreTask.fn({
      id: options.id,
      description: options.description ?? options.instructions,
      cache: options.cache ?? "by-input",
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      executor: executorIdentity,
      run: (input, context?: ExecutionContext) => {
        const runId = context?.runId
        if (!runId) return Effect.die(new Error(`Agent task ${options.id} requires a workflow run ID`))
        const attempt = context?.attempt ?? 1
        const nodeInstanceId = context?.nodeInstanceId ?? `${runId}:${options.id}`
        return options.endpoint.run<Input, Output>({
          version: AGENT_TASK_PROTOCOL_VERSION,
          runId,
          nodeId: options.id,
          nodeInstanceId,
          executionToken: `${runId}:${nodeInstanceId}:${attempt}`,
          attempt,
          input,
          instructions: options.instructions,
          executorIdentity,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.skills === undefined ? {} : { skills: options.skills }),
        })
      },
    })
  },
}
