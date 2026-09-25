import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const workspaceLinksReady = existsSync(resolve(root, "node_modules/@libclank/core"))

if (!workspaceLinksReady) {
  run("bun", ["install", "--ignore-scripts", "--registry=https://registry.npmjs.org"])
}

run("bun", ["run", "build:package"])

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
