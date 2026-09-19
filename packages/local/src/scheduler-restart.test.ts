import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { Id, Task, createTaskRegistry } from "@libclank/core"
import { DurableTaskScheduler, createWorkflowManifest } from "@libclank/scheduler"
import { createLocalSchedulerDatabase } from "./scheduler-database.js"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("local scheduler restart recovery", () => {
  it("reopens SQLite and completes a retryable node from persisted input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libclank-restart-"))
    directories.push(directory)
    const path = join(directory, "scheduler.sqlite")
    const runId = Id.run()
    const nodeId = Id.node("restartable")
    let firstProcess = true
    const task = Task.fn({
      id: nodeId,
      retry: { maxAttempts: 2, backoffMs: 0 },
      run: (input: { value: number }) =>
        Effect.try({
          try: () => {
            if (firstProcess) {
              firstProcess = false
              throw new Error("process stopped")
            }
            return input.value * 2
          },
          catch: (error) => error,
        }),
    })
    const firstDatabase = createLocalSchedulerDatabase(path)
    const manifest = await createWorkflowManifest({ workflowId: Id.workflow("restart"), tasks: [task.definition] })
    await firstDatabase.register(manifest)
    await firstDatabase.createRun({
      id: runId,
      workflowDefinitionHash: manifest.definitionHash,
      status: "running",
      input: { value: 21 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await firstDatabase.putNode({
      id: "instance",
      runId,
      nodeId,
      status: "ready",
      input: { value: 21 },
      inputArtifacts: [],
      attempt: 0,
    })
    await new DurableTaskScheduler({ database: firstDatabase, tasks: createTaskRegistry([task] as never[]) }).tick()
    expect((await firstDatabase.getNode("instance"))?.status).toBe("retry_wait")

    // A new database and scheduler instance represent a new local process.
    const restartedDatabase = createLocalSchedulerDatabase(path)
    await new DurableTaskScheduler({ database: restartedDatabase, tasks: createTaskRegistry([task] as never[]) }).tick(
      Date.now() + 1000,
    )
    const recovered = await restartedDatabase.getNode("instance")
    expect(recovered?.status).toBe("completed")
    expect(recovered?.output).toBe(42)
    expect(recovered?.input).toEqual({ value: 21 })
  })
})
