import type { SchedulerDatabase, SchedulerOperations } from "@libclank/scheduler"

export const createLocalSchedulerOperations = (database: SchedulerDatabase): SchedulerOperations => {
  if (!database.listWorkflows || !database.listRuns || !database.getNodes || !database.getEvents)
    throw new Error("Scheduler database does not expose operational queries")
  return {
    listWorkflows: database.listWorkflows,
    listRuns: database.listRuns,
    getRun: database.getRun,
    getNodes: database.getNodes,
    getEvents: database.getEvents,
  }
}
