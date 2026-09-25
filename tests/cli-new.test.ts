import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createProject } from "../cli/new.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("libclank new", () => {
  it("creates a Cloudflare project with agent, task, trigger, and workflow entry points", () => {
    const directory = temporaryDirectory()
    const result = createProject({ directory, name: "My Example", version: "0.1.4" })
    const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))

    expect(result.created).toContain("src/agents/index.ts")
    expect(result.created).toContain("src/agents/assistant.ts")
    expect(result.created).toContain("src/tasks/say-hello.ts")
    expect(result.created).toContain("src/triggers/hello.ts")
    expect(result.created).toContain("src/workflows/hello.ts")
    expect(packageJson.name).toBe("my-example")
    expect(packageJson.dependencies.libclank).toBe("git+https://github.com/leostera/libclank.git#v0.1.4")
    expect(packageJson.trustedDependencies).toContain("libclank")
    expect(readFileSync(join(directory, "src/workflows/index.ts"), "utf8")).toContain("helloWorkflow")
  })

  it("keeps existing application files and merges the manifest without replacing app configuration", () => {
    const directory = temporaryDirectory()
    mkdirSync(join(directory, "src"), { recursive: true })
    writeFileSync(join(directory, "src/worker.ts"), "// existing worker\n")
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "existing-app",
        scripts: { dev: "vite dev" },
        dependencies: { libclank: "file:../libclank", vite: "^8.0.0" },
      }),
    )

    const result = createProject({ directory, name: "ignored-name", version: "0.1.4" })
    const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))

    expect(readFileSync(join(directory, "src/worker.ts"), "utf8")).toBe("// existing worker\n")
    expect(result.skipped).toContain("src/worker.ts")
    expect(packageJson.name).toBe("existing-app")
    expect(packageJson.dependencies.libclank).toBe("file:../libclank")
    expect(packageJson.dependencies.vite).toBe("^8.0.0")
    expect(packageJson.scripts.dev).toBe("vite dev")
    expect(packageJson.scripts.libclank).toContain("node_modules/libclank/bin/libclank.ts")
    expect(packageJson.trustedDependencies).toContain("libclank")
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "libclank-new-"))
  temporaryDirectories.push(directory)
  return directory
}
