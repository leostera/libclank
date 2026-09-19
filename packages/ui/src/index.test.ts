import { describe, expect, it } from "vitest"
import { Id } from "@libclank/core"
import { createDashboardHandler } from "./index.js"

describe("dashboard handler", () => {
  it("serves operational data without authoring endpoints", async () => {
    const handler = createDashboardHandler({
      listWorkflows: async () => [],
      listRuns: async () => [],
      getRun: async () => undefined,
      getNodes: async () => [],
      getEvents: async () => [],
    })
    expect((await handler(new Request("http://localhost/"))).status).toBe(200)
    expect((await handler(new Request(`http://localhost/api/runs/${Id.run()}/tasks`, { method: "POST" }))).status).toBe(
      404,
    )
    expect(await (await handler(new Request("http://localhost/api/runs"))).json()).toEqual([])
  })
})
