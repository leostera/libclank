import { Hono } from "hono"
import { Id } from "@libclank/core"
import type { SchedulerOperations } from "@libclank/scheduler"

/** Hono API for operational workflow data. It intentionally has no authoring routes. */
export const createDashboardApi = (operations: SchedulerOperations): Hono => {
  const app = new Hono()
  app.get("/workflows", async (context) => context.json(await operations.listWorkflows()))
  app.get("/runs", async (context) => context.json(await operations.listRuns()))
  app.get("/runs/:runId", async (context) =>
    context.json(await operations.getRun(Id.runFrom(context.req.param("runId")))),
  )
  app.get("/runs/:runId/nodes", async (context) =>
    context.json(await operations.getNodes(Id.runFrom(context.req.param("runId")))),
  )
  app.get("/runs/:runId/events", async (context) =>
    context.json(await operations.getEvents(Id.runFrom(context.req.param("runId")))),
  )
  return app
}
