import { Effect } from "effect"
import { Task as CoreTask, type ExecutionContext, type NodeId, type NodeRun, type RunId, type Task as TaskNode } from "@libclank/core"

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
  }): TaskNode<Input, Output> {
    return CoreTask.fn({
      id: options.id,
      run: (input, context?: ExecutionContext) => {
        const runId = context?.runId
        if (!runId) return Effect.die(new Error(`Agent task ${options.id} requires a workflow run ID`))
        return options.endpoint.run<Input, Output>({
          version: AGENT_TASK_PROTOCOL_VERSION,
          runId,
          nodeId: options.id,
          attempt: 1,
          input,
          instructions: options.instructions,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.skills === undefined ? {} : { skills: options.skills }),
        })
      },
    })
  },
}
