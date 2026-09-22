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
  readonly attempt: number
  readonly input: Input
  readonly instructions: string
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
  }): TaskNode<Input, Output> {
    return CoreTask.fn({
      id: options.id,
      description: options.description ?? options.instructions,
      cache: options.cache ?? "by-input",
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      run: (input, context?: ExecutionContext) => {
        const runId = context?.runId
        if (!runId) return Effect.die(new Error(`Agent task ${options.id} requires a workflow run ID`))
        return options.endpoint.run<Input, Output>({
          version: AGENT_TASK_PROTOCOL_VERSION,
          runId,
          nodeId: options.id,
          attempt: context?.attempt ?? 1,
          input,
          instructions: options.instructions,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.skills === undefined ? {} : { skills: options.skills }),
        })
      },
    })
  },
}
