import { describe, expect, it } from "vitest"
import { createLinearWorkflowFixture, runWorkflowConformance } from "./workflow-conformance.js"

describe("workflow runtime conformance", () => {
  it("preserves a representative linear workflow result across eager and durable local execution", async () => {
    const fixture = createLinearWorkflowFixture()
    const result = await runWorkflowConformance(fixture)

    expect(result.eager).toMatchObject({ status: "completed", output: fixture.expectedOutput })
    expect(result.durable).toMatchObject({ status: "completed", output: fixture.expectedOutput })
    expect(result.durableEvents.map((event) => event.type)).toEqual([
      "trigger.received",
      "workflow.scheduled",
      "node.started",
      "node.completed",
      "node.started",
      "node.completed",
      "node.started",
      "node.completed",
      "workflow.completed",
    ])
  })
})
