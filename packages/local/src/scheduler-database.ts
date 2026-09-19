import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import {
  applyMigrations,
  type NodeInstanceRecord,
  type SchedulerDatabase,
  type WorkflowManifest,
  type WorkflowRunRecord,
} from "@libclank/scheduler"

/** Local portable SQLite implementation. Defaults to `<cwd>/.clank/scheduler.sqlite`. */
export const createLocalSchedulerDatabase = (path = resolve(".clank/scheduler.sqlite")): SchedulerDatabase => {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma("journal_mode = WAL")
  applyMigrations({
    exec: (sql) => db.exec(sql),
    appliedVersions: () =>
      (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]).map(
        (row) => row.version,
      ),
    record: (version) =>
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, Date.now()),
  })
  return {
    async register(manifest) {
      db.prepare("INSERT OR REPLACE INTO workflow_definitions VALUES (?, ?, ?, ?)").run(
        manifest.definitionHash,
        manifest.workflowId,
        JSON.stringify(manifest),
        Date.now(),
      )
    },
    async registerDeployment(deployment) {
      db.prepare(
        "INSERT OR REPLACE INTO scheduler_deployments (deployment_id, runtime, source_json, started_at, activated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        deployment.id,
        deployment.runtime,
        JSON.stringify(deployment.source),
        deployment.startedAt,
        deployment.activatedAt ?? null,
      )
    },
    async activateWorkflow(workflowId, definitionHash, deploymentId) {
      db.prepare(
        "INSERT OR REPLACE INTO active_workflow_definitions (workflow_id, definition_hash, deployment_id, activated_at) VALUES (?, ?, ?, ?)",
      ).run(workflowId, definitionHash, deploymentId, Date.now())
    },
    async definition(hash) {
      const row = db.prepare("SELECT manifest_json FROM workflow_definitions WHERE definition_hash=?").get(hash) as
        { manifest_json: string } | undefined
      return row ? (JSON.parse(row.manifest_json) as WorkflowManifest) : undefined
    },
    async createRun(run) {
      db.prepare(
        "INSERT INTO workflow_runs (run_id, definition_hash, status, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(run.id, run.workflowDefinitionHash, run.status, JSON.stringify(run.input), run.createdAt, run.updatedAt)
    },
    async updateRun(id, patch) {
      const fields: string[] = []
      const values: unknown[] = []
      if (patch.status !== undefined) {
        fields.push("status=?")
        values.push(patch.status)
      }
      if (patch.updatedAt !== undefined) {
        fields.push("updated_at=?")
        values.push(patch.updatedAt)
      }
      if (fields.length) db.prepare(`UPDATE workflow_runs SET ${fields.join(",")} WHERE run_id=?`).run(...values, id)
    },
    async getRun(id) {
      const row = db.prepare("SELECT * FROM workflow_runs WHERE run_id=?").get(id) as RunRow | undefined
      return row ? hydrateRun(row) : undefined
    },
    async putNode(node) {
      db.prepare("INSERT OR REPLACE INTO node_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        node.id,
        node.runId,
        node.nodeId,
        node.status,
        JSON.stringify(node.input),
        JSON.stringify(node.inputArtifacts),
        node.output === undefined ? null : JSON.stringify(node.output),
        node.outputArtifacts === undefined ? null : JSON.stringify(node.outputArtifacts),
        node.executionKey ?? null,
        node.attempt,
        node.nextAttemptAt ?? null,
        node.leaseExpiresAt ?? null,
        node.error === undefined ? null : JSON.stringify(node.error),
        Date.now(),
      )
    },
    async putDependency(runId, nodeInstanceId, dependsOnInstanceId) {
      db.prepare(
        "INSERT OR IGNORE INTO node_dependencies (run_id, node_instance_id, depends_on_instance_id) VALUES (?, ?, ?)",
      ).run(runId, nodeInstanceId, dependsOnInstanceId)
    },
    async getNode(id) {
      const row = db.prepare("SELECT * FROM node_instances WHERE instance_id=?").get(id) as NodeRow | undefined
      return row ? hydrateNode(row) : undefined
    },
    async cached(executionKey) {
      const row = db
        .prepare("SELECT * FROM node_instances WHERE execution_key=? AND status='completed' LIMIT 1")
        .get(executionKey) as NodeRow | undefined
      return row ? hydrateNode(row) : undefined
    },
    async ready(now) {
      const rows = db
        .prepare(
          "SELECT * FROM node_instances WHERE status IN ('ready','retry_wait') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY rowid",
        )
        .all(now) as NodeRow[]
      return rows.map(hydrateNode)
    },
    async claimNode(id, leaseMs) {
      const now = Date.now()
      const lease = now + leaseMs
      const result = db
        .prepare(
          "UPDATE node_instances SET status='running', attempt=attempt+1, lease_expires_at=?, updated_at=? WHERE instance_id=? AND status IN ('ready','retry_wait')",
        )
        .run(lease, now, id)
      if (!result.changes) return undefined
      const row = db.prepare("SELECT * FROM node_instances WHERE instance_id=?").get(id) as NodeRow
      return hydrateNode(row)
    },
    async appendEvent(event) {
      db.prepare("INSERT OR IGNORE INTO scheduler_events VALUES (?, ?, ?, ?, ?)").run(
        event.eventId,
        event.runId,
        event.type,
        JSON.stringify(event),
        Date.now(),
      )
    },
    async recoverExpired(now) {
      db.prepare(
        "UPDATE node_instances SET status='retry_wait', next_attempt_at=?, lease_expires_at=NULL WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
      ).run(now, now)
    },
    async listWorkflows() {
      return (
        db.prepare("SELECT manifest_json FROM workflow_definitions ORDER BY registered_at").all() as {
          manifest_json: string
        }[]
      ).map((row) => JSON.parse(row.manifest_json))
    },
    async listRuns() {
      return (db.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC").all() as RunRow[]).map(hydrateRun)
    },
    async getNodes(runId) {
      return (db.prepare("SELECT * FROM node_instances WHERE run_id=? ORDER BY rowid").all(runId) as NodeRow[]).map(
        hydrateNode,
      )
    },
    async getEvents(runId) {
      return (
        db.prepare("SELECT payload_json FROM scheduler_events WHERE run_id=? ORDER BY created_at").all(runId) as {
          payload_json: string
        }[]
      ).map((row) => JSON.parse(row.payload_json))
    },
  }
}

type RunRow = {
  run_id: string
  definition_hash: string
  status: WorkflowRunRecord["status"]
  input_json: string
  created_at: number
  updated_at: number
}
type NodeRow = {
  instance_id: string
  run_id: string
  node_id: string
  status: NodeInstanceRecord["status"]
  input_json: string
  input_artifacts_json: string
  output_json: string | null
  output_artifacts_json: string | null
  execution_key: string | null
  attempt: number
  next_attempt_at: number | null
  lease_expires_at: number | null
  error_json: string | null
  updated_at: number
}
const hydrateRun = (row: RunRow): WorkflowRunRecord => ({
  id: row.run_id as WorkflowRunRecord["id"],
  workflowDefinitionHash: row.definition_hash as WorkflowRunRecord["workflowDefinitionHash"],
  status: row.status,
  input: JSON.parse(row.input_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})
const hydrateNode = (row: NodeRow): NodeInstanceRecord => ({
  id: row.instance_id,
  runId: row.run_id as NodeInstanceRecord["runId"],
  nodeId: row.node_id as NodeInstanceRecord["nodeId"],
  status: row.status,
  input: JSON.parse(row.input_json),
  inputArtifacts: JSON.parse(row.input_artifacts_json),
  ...(row.output_json === null ? {} : { output: JSON.parse(row.output_json) }),
  ...(row.output_artifacts_json === null ? {} : { outputArtifacts: JSON.parse(row.output_artifacts_json) }),
  ...(row.execution_key === null ? {} : { executionKey: row.execution_key as `sha256:${string}` }),
  attempt: row.attempt,
  ...(row.next_attempt_at === null ? {} : { nextAttemptAt: row.next_attempt_at }),
  ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: row.lease_expires_at }),
  ...(row.error_json === null ? {} : { error: JSON.parse(row.error_json) }),
})
