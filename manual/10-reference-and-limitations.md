# Reference and limitations

This page is a practical map of the APIs available to workflow authors today. It also distinguishes stable usage patterns from features that are present but still maturing.

## Package map

| Package                | Use it for                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| `@libclank/core`       | IDs, `Node`, `Task`, triggers, composition, schemas, observers, eager scheduler |
| `@libclank/scheduler`  | Durable scheduler, manifests, local/DO-neutral database contracts, run state    |
| `@libclank/local`      | SQLite database, console observer, local artifacts, Pi endpoint, file helpers   |
| `@libclank/agent`      | `Task.agent` and the versioned agent endpoint protocol                          |
| `@libclank/cloudflare` | Hono trigger app, Cloudflare agent endpoint, Durable Object coordinator         |
| `@libclank/ui`         | Operational API, bundled dashboard, React dashboard components                  |
| `@libclank/artifacts`  | Content-addressed artifact types and operations                                 |

## IDs

```ts
import { Id } from "@libclank/core"

const nodeId = Id.node("fetch-markdown")
const triggerId = Id.trigger("ingest-url")
const workflowId = Id.workflow("daily-digest")
const runId = Id.run()
```

IDs are opaque TypeScript types and canonicalize to URI-like values:

```text
libclank://node/fetch-markdown
libclank://trigger/ingest-url
```

Use names, not hand-written URI casts. IDs may contain slash-separated stable namespaces:

```ts
Id.node("billing/send-receipt")
```

`.` and `..` path segments are rejected.

## Task constructors

### `Task.fn<Input, Output>`

```ts
Task.fn({
  id,
  run,
  description?,
  version?,
  cache?,
  retry?,
  input?,
  output?,
})
```

`run(input, context?)` returns an Effect. Input and output schemas are optional `RuntimeSchema` values. The durable executor validates them when present.

### `Task.effect<Input>`

```ts
Task.effect({ id, run, ... })
```

For a task whose output is `void`.

### `Task.agent<Input, Output>`

```ts
Task.agent({
  id,
  endpoint,
  instructions,
  model?,
  skills?,
  description?,
  version?,
  cache?,
})
```

Agent output validation belongs in the endpoint or a following typed task. `Task.agent` currently does not expose task-level input/output schema options.

## Composition reference

| Method                   | Output                      | Durable guidance                                                           |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------- |
| `node.then(task)`        | task output                 | Preferred way to create durable sequential steps                           |
| `node.then(callback)`    | callback output             | Eager convenience; prefer a named task if the result must be durable       |
| `node.tap(effect)`       | original node output        | Good for persisted ancillary work such as notification/opening an artifact |
| `node.map(transform)`    | transformed output          | Eager convenience; use a named task for durable transformation boundaries  |
| `node.mapEach(task)`     | array of task outputs       | Dynamic per-item instances; test carefully for your workload               |
| `node.forEach(factory)`  | array of outputs            | Best treated as eager composition currently                                |
| `node.fanout({ ... })`   | object keyed by branch name | Use for static independent durable branches                                |
| `Workflow.oneOf(nodes)`  | selected trigger output     | Multiple alternate eager trigger roots                                     |
| `Workflow.all(branches)` | object keyed by branch name | Multiple eager roots                                                       |

## Trigger constructors

```ts
Triggers.webhook({ id, path?, decode? })
Triggers.manual({ id })
Triggers.cron({ id, schedule, value })
```

`createTriggerApp` mounts webhook and manual routes. A cron definition describes a schedule but does not itself create a platform scheduler; your host must invoke it.

## Execution context

Task functions may inspect execution context:

```ts
const task = Task.fn<Input, Output>({
  id: Id.node("example"),
  run: (input, context) => {
    const runId = context?.runId
    const nodeId = context?.nodeId
    const triggerValue = context?.triggerValues.get(Id.trigger("source"))
    return doWork(input, { runId, nodeId, triggerValue })
  },
})
```

Do not depend on context being present when a node is called directly in a unit test.

## Scheduler constructors

### Eager scheduler

```ts
createScheduler({ workflows, observer })
```

Runs the composed root in process memory. Use it for non-durable local workflows and simple execution.

### Durable scheduler

```ts
await createDurableScheduler({
  workflows,
  database,
  observer,
  source?,
  runtime?,
})
```

Use it with `createLocalSchedulerDatabase()` for local persistence.

## Observer

```ts
SchedulerObservers.noop
createConsoleObserver()
```

An observer receives trigger, workflow, and node lifecycle callbacks. It is not the event store; observer errors are ignored to avoid breaking a run.

## Local helpers

```ts
createLocalSchedulerDatabase(path?)
createLocalSchedulerOperations(database)
discoverLocalSourceMetadata(options?)
createLocalArtifacts(options?)
createPiEndpoint(options)
fileOutput(input)
jsonFileOutput(decode)
jsonSchemaFileOutput(schema)
openFile({ id, required? })
```

## Operational HTTP routes

With `createDashboardApi` mounted under `/api`:

| Route                           | Meaning                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `GET /api/workflows`            | Stored workflow manifests                                      |
| `GET /api/runs`                 | Stored runs                                                    |
| `GET /api/runs/:runId`          | One run                                                        |
| `GET /api/runs/:runId/nodes`    | Durable node instances                                         |
| `GET /api/runs/:runId/events`   | Persisted event log                                            |
| `POST /api/triggers/:triggerId` | Start a trigger if application operations configure it         |
| `POST /api/runs`                | Start from a definition if application operations configure it |

The dashboard API does not authenticate or authorize requests on its own.

## Current limitations

The following constraints are important when choosing LibClank today.

### Local durable execution is the primary complete path

The most complete workflow path is:

```text
TypeScript workflow source
  → createDurableScheduler
  → createLocalSchedulerDatabase
  → Hono triggers/API
  → bundled dashboard
```

Cloudflare Durable Object support provides useful primitives and an application slice, but should not be assumed to have full feature parity with the local manifest scheduler.

### Trigger execution is synchronous today

The local durable facade executes a newly triggered run until it reaches a terminal/incomplete state before resolving `runTrigger`. Long-running agents therefore keep the initiating HTTP request open.

There is no complete built-in background queue, worker supervisor, or public `202 + poll` run-start flow yet.

### Recovery primitives exist; automatic global resume is application work

Leases, expired-work recovery, persisted definitions, and node state exist. However, applications need to own startup recovery/supervision for incomplete historical runs until a full hosted runner is exposed.

### Durable-safe composition is narrower than eager composition

For work that must be independently persisted and resumed, prefer named `Task` nodes connected by `then`, `tap`, or static `fanout`.

`map`, callback-based `then`, `forEach`, and multi-root `Workflow.all` are valuable composition APIs but do not all have equal durable materialization semantics. Model important transformation/fan-in boundaries as named tasks.

### Dynamic `mapEach` is evolving

The scheduler has dynamic item materialization primitives and a fan-out path. Dynamic graph visualization, full fan-in ergonomics, concurrency controls, and restart behavior need further hardening. Test this path with your own inputs before production adoption.

### Lifecycle commands are not complete

Run/node status types include cancellation-related states, but the operational public API does not yet provide complete pause, resume, cancel, retry-run, or retry-node commands.

### Events poll, not stream

Events persist and the dashboard polls them. There is no SSE/WebSocket subscription or event cursor API yet.

### Graph UI is static-topology first

The dashboard renders the manifest graph, statuses, attempts, and logs. It does not yet render each dynamic item instance as an individual visual node.

### Retry policy is still being consolidated

Task definitions carry retry metadata, and the durable scheduler has retry/recovery behavior. Verify the effective retry timing and attempt behavior your application depends on; task-level policy enforcement, execution-key caching, and error classification are ongoing work.

### At-least-once external effects

Persistence makes recovery possible, not exactly-once side effects. A process may fail after an external operation succeeds and before output is committed. Design external tasks to be idempotent.

### Local file paths are local

Example workflows pass file paths to Pi and `openFile`. These paths are not portable artifact references. Use `@libclank/artifacts` for immutable content that must be portable, and do not expose local filesystem paths in an untrusted dashboard.

### Dashboard security is your responsibility

The reference UI/API is an operational tool for trusted environments. Add authentication, authorization, redaction, and rate limits before exposing it.

## What to use in a new application

If you need a conservative, well-covered workflow today:

1. Start with a webhook trigger and `Task.fn` nodes.
2. Add Effect Schema to trigger and task boundaries.
3. Compose sequential work with `then`.
4. Use `fanout` only for independent static branches.
5. Store run state in `createLocalSchedulerDatabase`.
6. Use an idempotent external task design.
7. Test through a temporary SQLite file and real Hono request.
8. Mount the dashboard only behind trusted access.

For internal implementation rationale or the long-term architecture, read [`docs/rfds/`](../docs/rfds/), not this user manual.
