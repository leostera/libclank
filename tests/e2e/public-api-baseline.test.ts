import { describe, expect, it } from "vitest"
import * as agent from "@libclank/agent"
import * as artifacts from "@libclank/artifacts"
import * as cloudflare from "@libclank/cloudflare"
import * as core from "@libclank/core"
import * as local from "@libclank/local"
import * as scheduler from "@libclank/scheduler"

describe("RFD0002 public API baseline", () => {
  it("retains the currently documented workflow authoring and local runtime exports", () => {
    expect(Object.keys(core)).toEqual(
      expect.arrayContaining(["Id", "Node", "Task", "Triggers", "Workflow", "createScheduler"]),
    )
    expect(Object.keys(scheduler)).toEqual(
      expect.arrayContaining(["createDurableScheduler", "DurableTaskScheduler", "createWorkflowManifest"]),
    )
    expect(Object.keys(local)).toEqual(
      expect.arrayContaining(["createLocalSchedulerDatabase", "createLocalSchedulerOperations"]),
    )
    expect(Object.keys(agent)).toEqual(expect.arrayContaining(["AGENT_TASK_PROTOCOL_VERSION", "Task"]))
    expect(Object.keys(artifacts)).toEqual(expect.arrayContaining(["Artifacts"]))
    expect(Object.keys(cloudflare)).toEqual(
      expect.arrayContaining(["createAgentEndpoint", "createTriggerApp", "CloudflareWorkflowRun"]),
    )
  })
})
