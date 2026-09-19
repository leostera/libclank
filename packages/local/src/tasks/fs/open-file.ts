import { spawn } from "node:child_process"
import { Effect } from "effect"
import { Task, type NodeId } from "@libclank/core"

export interface LocalFile {
  readonly path: string
}

/**
 * A local-only effect task that opens a file in the operating system's
 * preferred application (`open`, `start`, or `xdg-open`).
 */
export const openFile = (options: { id: NodeId; required?: boolean }) =>
  Task.effect<LocalFile>({
    id: options.id,
    run: (file) => {
      const opening = Effect.tryPromise({
        try: () => runOpenCommand(file.path),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      return options.required === false ? Effect.catchCause(opening, () => Effect.void) : opening
    },
  })

function runOpenCommand(path: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" })
    child.once("error", reject)
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Could not open ${path}; ${command} exited with ${code}`)),
    )
  })
}
