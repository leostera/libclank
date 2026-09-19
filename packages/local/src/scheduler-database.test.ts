import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { createWorkflowManifest } from "@libclank/scheduler"
import { createLocalSchedulerDatabase } from "./scheduler-database.js"

const paths: string[] = []
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true })))
})

describe("local scheduler database", () => {
  it("persists node attempts and recovers expired leases", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "libclank-scheduler-")), "scheduler.sqlite")
    paths.push(path)
    const database = createLocalSchedulerDatabase(path)
    const task = Id.node("test-task")
    const workflow = await createWorkflowManifest({
      workflowId: Id.workflow("test"),
      tasks: [
        {
          id: task,
          description: "test",
          version: "1",
          cache: "by-input",
          dependencies: [],
          retry: { maxAttempts: 1, backoffMs: 1000 },
        },
      ],
    })
    await database.register(workflow)
    const runId = Id.run()
    await database.createRun({
      id: runId,
      workflowDefinitionHash: workflow.definitionHash,
      status: "running",
      input: { ok: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.putNode({
      id: "instance",
      runId,
      nodeId: task,
      status: "ready",
      input: { value: 1 },
      inputArtifacts: [],
      attempt: 0,
    })
    const claimed = await database.claimNode?.("instance", 1)
    expect(claimed?.status).toBe("running")
    await new Promise((resolve) => setTimeout(resolve, 5))
    await database.recoverExpired?.(Date.now())
    expect((await database.getNode("instance"))?.status).toBe("retry_wait")
  })
})
