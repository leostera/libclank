# Dashboard and operations

The LibClank dashboard is an operational console. It can inspect registered workflows and runs and start existing workflows. It does not create or edit workflow source.

## Mount the API

```ts
import { createLocalSchedulerOperations } from "@libclank/local"
import { createDashboardApi } from "@libclank/ui"

const operations = {
  ...createLocalSchedulerOperations(database),
  trigger: invokeTrigger,
  createRun: createRunFromDefinition,
}

app.route("/api", createDashboardApi(operations))
```

Read operations come directly from the scheduler database. Write operations are opt-in; absent handlers return `501`.

## Serve the bundled React application

Build `@libclank/ui`, then mount assets after API and hook routes:

```ts
import { createDashboardAssetHandler } from "@libclank/ui"

const dashboardAssets = createDashboardAssetHandler()
app.get("/*", (context) => dashboardAssets(context.req.raw))
```

Route ordering matters. Register `/hooks/*` and `/api/*` before the catch-all asset route.

The local examples serve everything from one origin:

```text
/                  dashboard
/api/*             operational API
/hooks/*           workflow triggers
```

## API reference

### List workflow definitions

```http
GET /api/workflows
```

Returns historical manifests. The dashboard groups by workflow ID and shows only the latest registered version in its start section.

### List runs

```http
GET /api/runs
```

### Get one run

```http
GET /api/runs/:runId
```

### Get node instances

```http
GET /api/runs/:runId/nodes
```

### Get persisted events

```http
GET /api/runs/:runId/events
```

### Invoke a trigger

```http
POST /api/triggers/:triggerId
Content-Type: application/json
```

The application-provided `operations.trigger` handler owns validation and must run the same trigger decoder used by the webhook route.

### Create from a registered definition

```http
POST /api/runs
Content-Type: application/json

{
  "workflowDefinitionHash": "sha256:...",
  "triggerId": "analyze-url",
  "input": { "url": "https://example.com" },
  "idempotencyKey": "optional-key"
}
```

The API validates the request envelope with Effect Schema. The application is responsible for checking that the definition exists and for applying trigger input decoding.

Idempotency-key enforcement is not yet implemented by the reference local operations layer.

## Run graph

Open a run from the dashboard to navigate to:

```text
/#/runs/<run-id>
```

The run page displays:

- trigger nodes;
- static task topology;
- persisted status per step;
- attempt count;
- animated running edges;
- completed, failed, running, and pending colors;
- a right-hand run-log column.

The log column shows persisted event type, node ID, output, and serialized error where available.

## Refresh behavior

The current UI uses polling:

- run list: every 5 seconds;
- run graph, node state, and logs: every 2 seconds.

There is no SSE or WebSocket endpoint yet. Polling is simple and reconnect-safe, but updates are not instantaneous and repeated requests become expensive at larger scale.

## Dynamic instances

Dynamic `mapEach` instances are persisted. The current graph is primarily manifest-based and does not yet render every dynamic item as an independent visual node. Inspect `/api/runs/:runId/nodes` to see all persisted instances.

## Historical definitions

Changing workflow metadata or topology produces a new definition hash. Historical manifests remain available so old run graphs can resolve against the definition they used.

The dashboard's registered-workflows section intentionally hides older versions. This does not delete them.

## Security

The reference dashboard has no built-in authentication or authorization. Before exposing it outside a trusted local environment:

- authenticate all `/api` and `/hooks` routes;
- authorize workflow starts and run inspection separately;
- redact secrets from task inputs, outputs, and errors;
- apply request size limits;
- add CSRF protection if cookie authentication is used;
- avoid returning sensitive agent prompts or artifacts by default.

Persisted errors can include stack traces and filesystem paths. Treat the operational API as sensitive.
