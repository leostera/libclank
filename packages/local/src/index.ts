import { access } from "node:fs/promises"

export { openFile, type LocalFile } from "./tasks/fs/open-file.js"

/** Human-readable local execution logging for development servers. */
export const createConsoleObserver = (write: (line: string) => void = console.log): SchedulerObserver => ({
  triggerReceived: ({ triggerId, payload }) => write(`${stamp()} trigger received ${Id.name(triggerId)}\n  payload: ${render(payload)}`),
  workflowScheduled: ({ runId, workflowId }) => write(`${stamp()} workflow scheduled ${Id.name(workflowId)}\n  run: ${runId}`),
  nodeStarted: ({ runId, nodeId }) => write(`${stamp()} node started ${Id.name(nodeId)}${runId ? `\n  run: ${runId}` : ""}`),
  nodeCompleted: ({ runId, nodeId, output, durationMs }) => write(`${stamp()} node completed ${Id.name(nodeId)} (${durationMs}ms)${runId ? `\n  run: ${runId}` : ""}\n  output: ${render(output)}`),
  nodeFailed: ({ runId, nodeId, error, durationMs }) => write(`${stamp()} node failed ${Id.name(nodeId)} (${durationMs}ms)${runId ? `\n  run: ${runId}` : ""}\n  error: ${render(error)}`),
  workflowCompleted: ({ runId, workflowId, status }) => write(`${stamp()} workflow ${status} ${Id.name(workflowId)}\n  run: ${runId}`),
})

export const logListeningTriggers = (triggers: readonly TriggerDefinition[], write: (line: string) => void = console.log): void => {
  for (const trigger of triggers) {
    const detail = trigger.kind === "cron" ? trigger.schedule : trigger.path
    write(`${stamp()} listening for ${trigger.kind} ${Id.name(trigger.id)}${detail ? ` at ${detail}` : ""}`)
  }
}

function stamp(): string { return new Date().toISOString() }
function render(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}
import { spawn } from "node:child_process"
import { Effect } from "effect"
import type { AgentEndpoint, AgentTaskRequest } from "@libclank/agent"
import { Id, type SchedulerObserver, type TriggerDefinition } from "@libclank/core"

export interface PiEndpointOptions {
  /** Turns a LibClank agent task into a Pi prompt. */
  prompt(request: AgentTaskRequest<unknown>): string
  /** Verifies the side effect and returns the task output after Pi exits. */
  output<Input, Output>(input: Input): Promise<Output>
  command?: string
}

/** A local-only AgentEndpoint backed by Pi's non-interactive CLI. */
export const createPiEndpoint = (options: PiEndpointOptions): AgentEndpoint => ({
  run: <Input, Output>(request: AgentTaskRequest<Input>) => Effect.tryPromise({
    try: async () => {
      await run(options.command ?? "pi", ["--print", "--no-session", "--approve", options.prompt(request as AgentTaskRequest<unknown>)])
      return options.output<Input, Output>(request.input)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  }),
})

/** Fails if Pi did not create the expected artifact. */
export const fileOutput = async <Input extends { path: string }>(input: Input): Promise<Input> => {
  try {
    await access(input.path)
  } catch {
    throw new Error(`Pi completed without creating the required artifact: ${input.path}`)
  }
  return input
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)))
  })
}
