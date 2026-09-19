# PLAN0001 — LibClank operations dashboard

## Status

Proposed.

## Goal

Build `@libclank/ui` into a production-quality operations console that is started and served by a LibClank scheduler. The dashboard manages source-defined workflows and their durable runtime state; it never authors or edits workflows, tasks, prompts, or agents.

A consumer should only need to start the scheduler:

```ts
const scheduler = await createScheduler({ workflows })
await scheduler.start({ port: 8789 })
```

The resulting process serves one origin:

```text
/                 bundled React application
/api/*            Hono operations API
/hooks/*          workflow triggers
```

Vite remains an internal development tool for `@libclank/ui`; consumers do not need LibClank's source tree or a second process.

## Product boundaries

### In scope

- Left-navigation application shell.
- Workflow inventory, current definitions, historical versions, topology, source metadata, and related runs.
- Run inventory, filters, creation flow, live execution graph, events/logs, attempts, artifacts, and lifecycle controls.
- Artifact inventory, provenance, preview, and download.
- Local SQLite/filesystem and Cloudflare Durable Object/artifact parity.
- Read and command APIs implemented with Hono.
- Runtime validation at every HTTP/storage boundary with Effect Schema.

### Out of scope

- Visual workflow, task, prompt, or agent authoring.
- Editing deployed manifests from the UI.
- Arbitrary code execution from the browser.
- Mutating historical workflow definitions.
- Deleting artifacts or defining retention policy in the first slice.
- Suspending an already-running external process at an arbitrary instruction.

Source code and deployment remain the only authoring path.

## Current baseline and prerequisite gaps

The repository currently has:

- persisted workflow manifests and definition hashes;
- local SQLite run/node/event storage;
- local restart recovery;
- content-addressed local artifacts;
- Hono read endpoints;
- a bundled React client and React Flow graph;
- initial workflow/run lists and trigger controls.

Before the dashboard can represent runtime state accurately, these gaps must be closed:

1. The scheduler still executes a composed root eagerly in important paths instead of scheduling each persisted step independently.
2. A task definition ID is currently also treated as a graph node ID. Reusing one task at multiple call sites therefore collapses distinct workflow steps. The manifest needs separate **task definition IDs** and **workflow step IDs**.
3. Dynamic `mapEach` instances need runtime graph nodes tied to a static template step.
4. Workflow registration does not yet distinguish the currently loaded definition from historical definitions.
5. Trigger inputs do not expose a serializable schema from which the dashboard can build a form.
6. Artifacts are content-addressed but do not yet have an indexed occurrence/provenance model for browsing.
7. Run pause/resume/cancel/retry commands are not durable scheduler operations yet.
8. Events need an ordered cursor suitable for live streaming.

These are dashboard-enabling runtime changes and are part of this plan.

## Package responsibilities

### `@libclank/core`

- Source-defined tasks, triggers, workflows, and IDs.
- Trigger input schemas and runtime decoders.
- Declarative workflow-plan metadata carried alongside executable closures.
- No persistence, HTTP server, UI, Git calls, or runtime-specific storage.

### `@libclank/scheduler`

- Workflow-plan/manifest compiler.
- Definition registration and active-version tracking.
- Durable run, step, attempt, dependency, event, and artifact-provenance state.
- Lifecycle command semantics.
- Runtime-neutral `SchedulerOperations` query/command service.

### `@libclank/artifacts`

- Immutable content references and shared artifact metadata contracts.
- Distinction between deduplicated content and a run-specific artifact occurrence.

### `@libclank/local`

- Portable SQLite adapter.
- Filesystem artifact content backend.
- Local Git metadata discovery.
- Complete local scheduler startup, Hono mounting, and bundled UI asset serving.

### `@libclank/cloudflare`

- Durable Object SQLite operations adapter.
- Alarm/wakeup behavior for lifecycle commands.
- Cloudflare artifact-content adapter.
- Static asset binding and Hono mounting.

### `@libclank/ui`

- Shared Effect Schema API contracts.
- Hono operations API.
- React application, React Flow graph, and compiled assets.
- No direct database or filesystem access.

## Workflow topology and manifest v2

### Separate definitions from call sites

A task may be reused multiple times in one workflow. The manifest must not deduplicate those invocations into one graph node.

```ts
interface WorkflowStep {
  readonly stepId: StepId // unique call-site ID
  readonly taskId?: NodeId // source implementation, when this is a task
  readonly kind: "trigger" | "task" | "transform" | "fanout" | "fanin" | "map-template"
  readonly label: string
  readonly description?: string
}

interface WorkflowEdge {
  readonly id: string
  readonly from: StepId
  readonly to: StepId
  readonly kind: "data" | "control"
  readonly outputPort?: string
  readonly inputPort?: string
}
```

For example, three uses of `openAnalysis` share one `taskId` but have three branch-qualified `stepId`s.

### Complete static topology

`WorkflowManifest` schema version 2 contains:

- workflow identity and definition hash;
- all static steps, including triggers and structural steps;
- all static data/control edges;
- task definitions referenced by steps;
- trigger definitions and input JSON Schemas;
- retry/cache/agent metadata;
- deployment/source metadata reference.

The frontend renders the topology directly. It must not infer edges by parsing LibClank URI strings.

### Dynamic topology

A static `mapEach` step records its template subgraph. When a run materializes items, the scheduler persists runtime step instances such as:

```text
summarize-link[item-key-1]
summarize-link[item-key-2]
summarize-link[item-key-3]
```

Run graph responses combine the static manifest with materialized instances and dynamic edges.

### Manifest compatibility

- Continue reading schema-version-1 manifests for historical runs.
- Normalize old manifests to a read-only compatibility DTO.
- New runs use manifest v2 only after the source implementation is loaded.
- A historical definition unavailable in the current process remains inspectable but cannot be triggered or retried.

## Workflow registration, versions, and Git metadata

### Current versus historical definitions

Add an atomic startup registration pass:

1. Begin a deployment/registration record.
2. Compile and persist every loaded workflow manifest.
3. Replace the active-definition mapping for each loaded `workflowId`.
4. Finalize the registration only after all workflows succeed.
5. Retain old immutable definitions and their runs as history.

Suggested tables:

```text
scheduler_deployments
  deployment_id
  runtime
  source_json
  started_at
  activated_at

workflow_definitions
  definition_hash
  workflow_id
  manifest_json
  first_registered_at
  last_registered_at

active_workflow_definitions
  workflow_id
  definition_hash
  deployment_id
  activated_at
```

The workflow list groups by `workflowId`, presents the active definition first, and reports the number of previous versions. Historical versions are labeled clearly and are never shown as duplicate current workflows.

### Source metadata

Capture source metadata when definitions are registered, not from the browser:

```ts
interface SourceMetadata {
  readonly repository?: string
  readonly commitSha?: string
  readonly branch?: string
  readonly dirty?: boolean
  readonly packagePath?: string
  readonly deployedAt: number
}
```

- Local runtime: best-effort Git discovery through a dedicated `@libclank/local` provider.
- Cloudflare: inject repository/ref/SHA from deployment environment or build metadata.
- Missing Git metadata never prevents scheduler startup.
- The dashboard only displays persisted metadata; it does not execute Git commands.

## Trigger input contracts and new-run flow

Triggers must expose both a source runtime decoder and a serializable representation:

```ts
Triggers.webhook({
  id: Id.trigger("analyze-url"),
  input: SourceInputSchema,
  // request extraction remains runtime-specific
})
```

At registration:

- compile Effect Schema to JSON Schema draft 2020-12;
- store it in the trigger manifest;
- retain the Effect Schema decoder in the source-loaded trigger registry.

At invocation:

- parse every HTTP body with Effect Schema;
- do not cast `unknown` payloads;
- return a structured `400` error with paths/issues;
- persist only successfully decoded input.

The UI form renderer initially supports:

- string, URI, number, integer, boolean;
- enum/select;
- required/optional object properties;
- arrays of primitives;
- raw JSON fallback for unsupported schemas.

A new run targets one exact active workflow definition and one of its triggers. It must not implicitly invoke every workflow sharing a trigger ID.

## Durable run lifecycle

### Status model

Extend durable run state:

```text
pending
running
pause_requested
paused
completed
failed
cancel_requested
cancelled
blocked_definition_unavailable
```

### Pause semantics

Pause is cooperative and durable:

1. `POST /runs/:runId/pause` atomically moves `running -> pause_requested`.
2. The scheduler stops claiming new step instances immediately.
3. Already-running external work may finish and persist its result.
4. Once no step lease is active, the run becomes `paused`.
5. Restart recovery preserves the paused state and does not claim work.

The UI must describe this as “stop scheduling new work,” not process suspension.

### Resume semantics

1. `POST /runs/:runId/resume` moves `paused|pause_requested -> running`.
2. Local runtime wakes its scheduler loop.
3. Cloudflare runtime schedules a DO alarm/wakeup.
4. Ready and overdue retry nodes continue from persisted inputs.

### Cancel and retry

- Cancel stops new claims and requests cancellation from active executors where supported.
- Retry run creates a new run linked by `parentRunId`, retaining the original run unchanged.
- A later slice may support retrying one failed step in-place; it is not required for the first dashboard release.
- Every command is idempotent and validates legal state transitions transactionally.

## Artifact inventory and provenance

Content-addressed bytes and artifact occurrences are different concepts.

```ts
interface ArtifactOccurrence {
  readonly occurrenceId: string
  readonly ref: ArtifactRef
  readonly runId: RunId
  readonly stepInstanceId: string
  readonly attempt: number
  readonly logicalName: string
  readonly createdAt: number
}
```

Add an artifact metadata/index table while retaining content deduplication by digest. Record every input/output attachment before a step is marked complete.

The first artifact UI supports:

- filtering by workflow, run, media type, and date;
- provenance links to run, step, and attempt;
- inline preview for text, Markdown, JSON, and images;
- metadata and digest display;
- safe download endpoint with explicit content type/disposition;
- no arbitrary local filesystem paths in API responses.

## Ordered events and live updates

Add a monotonically increasing sequence per run. Ordering by timestamps alone is insufficient.

```text
run_events
  run_id
  sequence
  event_id
  type
  payload_json
  created_at
```

Provide:

```text
GET /api/runs/:runId/events?after=<sequence>
GET /api/runs/:runId/stream?after=<sequence>   # SSE
```

The React application uses SSE for live run state and invalidates affected queries. Polling remains a reconnect/fallback mechanism.

Event types needed by the dashboard include:

- run lifecycle changes;
- step ready/started/completed/failed/cache-hit;
- retry scheduled;
- artifact created/attached;
- structured executor/agent log messages;
- dynamic step materialization.

## Hono API

### Contract rules

- Define request and response contracts once with Effect Schema.
- Parse path/query/body values from `unknown`; avoid type assertions.
- Return a consistent error envelope.
- Use cursor pagination for tables and event history.
- Keep domain operations outside Hono handlers.
- Commands return `202` when work continues asynchronously.

### Workflow endpoints

```text
GET /api/workflows
GET /api/workflows/:workflowKey
GET /api/workflows/:workflowKey/versions
GET /api/workflows/:workflowKey/runs
GET /api/workflow-definitions/:definitionHash
```

`workflowKey` is a URL-safe encoding of the canonical workflow ID and is decoded/validated at the boundary.

### Run endpoints

```text
GET  /api/runs
POST /api/runs
GET  /api/runs/:runId
GET  /api/runs/:runId/graph
GET  /api/runs/:runId/nodes
GET  /api/runs/:runId/attempts
GET  /api/runs/:runId/events
GET  /api/runs/:runId/stream
GET  /api/runs/:runId/artifacts
POST /api/runs/:runId/pause
POST /api/runs/:runId/resume
POST /api/runs/:runId/cancel
POST /api/runs/:runId/retry
```

Run creation body:

```ts
{
  workflowDefinitionHash: string
  triggerId: string
  input: unknown
  idempotencyKey?: string
}
```

### Artifact endpoints

```text
GET /api/artifacts
GET /api/artifacts/:occurrenceId
GET /api/artifacts/:occurrenceId/content
```

### Operations service

Split the current optional-method interface into explicit capabilities:

```ts
interface SchedulerQueries {
  /* required reads */
}
interface SchedulerCommands {
  /* required lifecycle commands */
}
interface SchedulerOperations extends SchedulerQueries, SchedulerCommands {}
```

Local and Cloudflare adapters must pass the same contract tests.

## React application architecture

Avoid growing `Dashboard.tsx` or `RunGraph.tsx` into godfiles.

```text
packages/ui/src/
  app/
    App.tsx
    AppShell.tsx
    routes.tsx
    navigation.ts
  api/
    client.ts
    schemas.ts
    queries.ts
  components/
    DataTable.tsx
    EmptyState.tsx
    StatusBadge.tsx
    PageHeader.tsx
    JsonSchemaForm.tsx
  workflows/
    WorkflowsPage.tsx
    WorkflowDetailPage.tsx
    WorkflowGraph.tsx
    WorkflowVersions.tsx
  runs/
    RunsPage.tsx
    NewRunPage.tsx
    RunDetailPage.tsx
    RunGraph.tsx
    RunEvents.tsx
    RunAttempts.tsx
    RunControls.tsx
  artifacts/
    ArtifactsPage.tsx
    ArtifactDetailPage.tsx
    ArtifactPreview.tsx
```

Use:

- React Router for application routes;
- TanStack Query for query caching, mutations, polling fallback, and invalidation;
- React Flow for workflow/run graphs;
- Effect Schema in the API client;
- semantic HTML and CSS variables for the visual system.

Create the React root exactly once and mount a router beneath it.

## Information architecture

### Application shell

Persistent left navigation:

```text
LibClank
  Workflows
  Runs
  Artifacts
```

The shell also shows runtime connectivity and the current scheduler/deployment identity.

### Workflows page

Table columns:

- workflow name/ID;
- active definition version;
- source commit/branch;
- trigger count;
- step count;
- recent run status/count;
- last registered timestamp.

Workflow detail contains:

- metadata/source header;
- static topology graph;
- triggers and input schemas;
- definition/version history;
- recent runs;
- task/cache/retry metadata.

Historical versions are read-only and visually distinguished from the active version.

### Runs page

Table columns and filters:

- run ID;
- workflow/version;
- status;
- trigger;
- started/updated/duration;
- attempt/retry summary;
- artifact count.

A primary **New run** action opens the creation flow:

1. Select an active workflow.
2. Select one supported trigger.
3. Render fields from its input schema.
4. Validate locally and on the server.
5. Start the run and navigate to its detail page.

### Run detail

Header:

- status and duration;
- workflow/version/source link;
- pause/resume/cancel/retry controls appropriate to current state.

Tabs:

```text
Overview | Graph | Logs | Attempts | Artifacts
```

Graph requirements:

- top-down deterministic layout;
- centered fan-out/fan-in branches;
- trigger nodes included;
- static steps overlaid with live runtime status;
- dynamic map instances shown under their template;
- node selection opens an inspector with input, output, errors, attempts, and artifacts;
- cached/retried/failed states are visually distinct;
- graph consumes the server's graph DTO and never reconstructs topology from IDs.

Logs/events requirements:

- ordered by sequence;
- live updates through SSE;
- filtering by step, event type, level, and attempt;
- structured payload viewer;
- auto-follow toggle.

### Artifacts page

Table/grid with:

- logical name;
- media type and size;
- workflow/run/step provenance;
- digest;
- created timestamp;
- preview/download actions.

## Styling and accessibility

- Responsive fixed/collapsible sidebar.
- Dense but readable operational tables.
- Shared status colors with text/icon labels; never color-only status.
- Keyboard-accessible navigation and controls.
- Focus management after navigation and mutations.
- Accessible table headers, forms, dialogs, and graph fallback list.
- Empty, loading, stale, disconnected, and error states for every page.
- Preserve useful browser URLs for workflows, runs, tabs, and filters.

## Runtime assembly

The local public API should own the complete serving lifecycle:

```ts
import { createScheduler } from "@libclank/local"

const scheduler = await createScheduler({ workflows })
await scheduler.start({ port: 8789 })
```

`start()` performs:

1. database migrations;
2. source metadata discovery;
3. workflow compilation/registration;
4. restart/lease reconciliation;
5. scheduler loop startup;
6. Hono trigger and operations API mounting;
7. bundled dashboard asset serving;
8. one canonical runtime URL log.

The Cloudflare adapter exposes equivalent routes through its Worker and asset binding.

## Security

- Local runtime binds to loopback by default.
- Binding to a public interface requires an explicit option.
- Cloudflare and public deployments accept injectable authentication/authorization middleware.
- Mutating routes require authorization and origin/CSRF consideration.
- Artifact content is served by occurrence ID after authorization; local paths are never accepted from the request.
- UI rendering escapes untrusted logs, Markdown, filenames, and metadata.
- Secrets and full environment values are never stored in manifests or source metadata.

## Database migrations

Introduce an actual migration mechanism before changing existing tables:

```text
schema_migrations(version, applied_at)
```

Migrations must be transactional and shared semantically between local SQLite and Durable Object SQLite. Tests cover opening a database created by the current schema and upgrading it without deleting `.clank`.

## Delivery plan

### Phase 1 — Durable dashboard model

- [ ] Add SQLite migration runner and baseline migration.
- [ ] Add manifest v2 with unique workflow step IDs and complete topology.
- [ ] Persist per-step execution rather than only the eager root node.
- [ ] Add active workflow registration and historical version tracking.
- [ ] Capture optional local/Cloudflare source metadata.
- [ ] Add topology tests for sequence, tap, fan-out, fan-in, task reuse, and map templates.

Suggested commits:

```text
feat: add scheduler database migrations
feat: compile versioned workflow execution plans
feat: track active workflow definitions and source metadata
test: cover complete workflow manifest topology
```

### Phase 2 — Typed operations API

- [ ] Add shared Effect Schema DTO contracts and error envelope.
- [ ] Expose trigger input schemas in manifests.
- [ ] Replace broad trigger invocation with exact workflow/version run creation.
- [ ] Add grouped workflow/version/run queries and cursor pagination.
- [ ] Add ordered events and SSE.
- [ ] Add durable pause/resume/cancel/retry commands.
- [ ] Add local and Cloudflare operations contract tests.

Suggested commits:

```text
feat: add typed scheduler operations contracts
feat: add schema-driven run creation
feat: add durable run lifecycle controls
feat: stream ordered run events
test: cover scheduler operations API
```

### Phase 3 — Artifact operations

- [ ] Add artifact-occurrence/provenance records.
- [ ] Attach input/output artifacts transactionally to attempts.
- [ ] Add artifact list/detail/content APIs.
- [ ] Add safe preview/download handling.
- [ ] Add local and Cloudflare artifact API tests.

Suggested commits:

```text
feat: index artifact provenance
feat: add artifact operations API
test: cover artifact browsing and downloads
```

### Phase 4 — Application shell and workflow experience

- [ ] Split the current UI into routed feature modules.
- [ ] Add left navigation and shared visual system.
- [ ] Add workflow table and detail routes.
- [ ] Add version/source/history views.
- [ ] Render static topology from manifest v2.

Suggested commits:

```text
feat: add dashboard application shell
feat: add workflow inventory and history views
feat: render versioned workflow topology
```

### Phase 5 — Run operations experience

- [ ] Add runs table, filters, and pagination.
- [ ] Add schema-driven New run flow.
- [ ] Add run detail header and lifecycle controls.
- [ ] Add live graph, logs, attempts, and artifacts tabs.
- [ ] Add node inspector and dynamic graph instances.

Suggested commits:

```text
feat: add run inventory and creation flow
feat: add live run operations view
feat: add run logs attempts and node inspector
```

### Phase 6 — Artifact experience and runtime packaging

- [ ] Add artifact inventory/detail/preview pages.
- [ ] Ensure local `createScheduler().start()` serves the complete application.
- [ ] Ensure Cloudflare serves the same application and API contract.
- [ ] Add auth extension points and deployment documentation.
- [ ] Add end-to-end browser coverage.

Suggested commits:

```text
feat: add artifact inventory and previews
feat: serve operations console from scheduler runtimes
test: cover dashboard operations end to end
docs: document the LibClank operations console
```

## Test strategy

### Unit tests

- Effect Schema request/response parsing and useful failures.
- Manifest topology and stable definition hashes.
- Workflow grouping/current-version selection.
- Graph layout for linear, fan-out, fan-in, and reused tasks.
- Legal/illegal lifecycle transitions.
- Artifact preview/content-type behavior.

### SQLite integration tests

- Migration from the existing database schema.
- Atomic active-definition replacement while history remains readable.
- Pause/restart/resume behavior.
- Retry linkage and idempotency.
- Ordered event cursors.
- Artifact provenance queries.

### Hono contract tests

- Every route validates params/query/body.
- Missing resources return `404`, invalid input `400`, conflicts `409`.
- Commands are idempotent.
- Pagination and filtering are stable.
- No authoring endpoints exist.

### React tests

- Navigation and deep links.
- Grouped workflow versions without duplicate keys.
- New-run schema form validation.
- Run control availability by status.
- Live event updates and reconnect behavior.
- Artifact previews and error states.

### End-to-end tests

- Start the local scheduler and load the bundled dashboard from the same port.
- Trigger a run from the UI.
- Observe live graph/event changes.
- Pause, restart the process, and resume the run.
- Open an output artifact from the completed run.
- Verify a historical workflow version remains inspectable after source changes.

Run on every delivery phase:

```bash
bun run format:check
bun run build
bun run typecheck
bun run test
```

## Acceptance criteria

- One scheduler command serves triggers, Hono API, and the bundled React application on one origin.
- The left navigation exposes Workflows, Runs, and Artifacts.
- Workflows are grouped by canonical ID, with one active version and inspectable history.
- Workflow details show source metadata, triggers, complete static topology, versions, and related runs.
- A user can create a run by selecting a workflow/trigger and completing a schema-derived form.
- Run detail shows a correct top-down graph, live ordered logs, attempts, and artifact provenance.
- Pause survives process restart; resume continues from persisted ready inputs without replaying completed work.
- Artifacts are browsable and downloadable without exposing host paths.
- Local and Cloudflare runtimes implement the same operations contracts.
- All external data is parsed with Effect Schema rather than trusted through casts.
- The UI contains no task/workflow authoring capability.

## Proposed defaults requiring confirmation

1. Pause is cooperative: currently running work may finish, but no new work starts.
2. Historical workflow versions are inspectable but not triggerable unless their exact source implementation is loaded.
3. Retrying a run creates a linked new run instead of mutating history.
4. Artifact deletion/retention controls are deferred.
5. Local dashboard access is unauthenticated on loopback only; public deployments must supply auth middleware.
