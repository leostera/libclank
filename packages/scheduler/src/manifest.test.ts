import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { createExecutionKey } from "./execution-key.js"
import { createWorkflowManifest } from "./manifest.js"

describe("workflow manifests and execution keys", () => {
  const task = {
    id: Id.node("task"),
    description: "A task",
    version: "1",
    cache: "by-input" as const,
    dependencies: [],
    retry: { maxAttempts: 2, backoffMs: 100 },
  }

  it("hashes equivalent manifests identically regardless of declaration order", async () => {
    const first = await createWorkflowManifest({ workflowId: Id.workflow("demo"), tasks: [task] })
    const second = await createWorkflowManifest({ workflowId: Id.workflow("demo"), tasks: [{ ...task }] })
    expect(first.definitionHash).toBe(second.definitionHash)
    expect(first.schemaVersion).toBe(1)
  })

  it("changes the execution key when input or task version changes", async () => {
    const manifest = await createWorkflowManifest({ workflowId: Id.workflow("demo"), tasks: [task] })
    const first = await createExecutionKey({
      workflowDefinitionHash: manifest.definitionHash,
      task,
      input: { value: 1 },
      inputArtifacts: [],
    })
    const differentInput = await createExecutionKey({
      workflowDefinitionHash: manifest.definitionHash,
      task,
      input: { value: 2 },
      inputArtifacts: [],
    })
    const differentVersion = await createExecutionKey({
      workflowDefinitionHash: manifest.definitionHash,
      task: { ...task, version: "2" },
      input: { value: 1 },
      inputArtifacts: [],
    })
    expect(first).not.toBe(differentInput)
    expect(first).not.toBe(differentVersion)
  })
})
