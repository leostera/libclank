# Local durable runtime

The local durable runtime combines:

- `createDurableScheduler` from `@libclank/scheduler`;
- `createLocalSchedulerDatabase` from `@libclank/local`;
- Hono trigger routes from `@libclank/cloudflare`;
- optional operational API and React dashboard from `@libclank/ui`.

## Minimal setup

```ts
const database = createLocalSchedulerDatabase()

const scheduler = await createDurableScheduler({
  workflows: [workflow],
  database,
  observer: createConsoleObserver(),
})

const app = createTriggerApp(scheduler)
Bun.serve({ port: 8789, fetch: app.fetch })
```

By default, SQLite is stored at:

```text
<current working directory>/.clank/scheduler.sqlite
```

Choose a path explicitly when application working directories may vary:

```ts
const database = createLocalSchedulerDatabase(resolve("./var/libclank/scheduler.sqlite"))
```

The local database uses WAL mode and applies scheduler migrations at startup.

## Add source metadata

Deployment registration can include best-effort Git metadata:

```ts
import { discoverLocalSourceMetadata } from "@libclank/local"

const scheduler = await createDurableScheduler({
  workflows: [workflow],
  database,
  observer,
  source: await discoverLocalSourceMetadata({
    repository: "leostera/libclank",
    packagePath: "examples/my-workflow",
  }),
  runtime: "local",
})
```

Recorded metadata can include commit SHA, branch, dirty status, repository, package path, and deployment time.

## Add the dashboard and API

```ts
import { Id } from "@libclank/core"
import { createLocalSchedulerOperations } from "@libclank/local"
import { createDashboardApi, createDashboardAssetHandler } from "@libclank/ui"

const invokeTrigger = async (triggerId: string, input: unknown) => {
  const id = Id.trigger(triggerId)
  const definition = scheduler.triggers.find((trigger) => trigger.id === id)
  if (!definition) throw new Error(`Unknown trigger: ${triggerId}`)

  // API/dashboard calls begin with raw JSON, just like webhook calls.
  const decoded = definition.decode
    ? await definition.decode(
        new Request("http://local.invalid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      )
    : input

  return scheduler.runTrigger(id, decoded)
}

const operations = {
  ...createLocalSchedulerOperations(database),
  trigger: invokeTrigger,
  createRun: async ({ workflowDefinitionHash, triggerId, input }) => {
    if (!(await database.definition(workflowDefinitionHash))) {
      throw new Error(`Unknown workflow definition: ${workflowDefinitionHash}`)
    }
    return invokeTrigger(triggerId, input)
  },
}

app.route("/api", createDashboardApi(operations))

const assets = createDashboardAssetHandler()
app.get("/*", (context) => assets(context.req.raw))
```

The explicit decode step is important. `createTriggerApp` invokes a webhook decoder automatically, but custom dashboard operations call `scheduler.runTrigger` directly. Passing raw dashboard JSON around the decoder can omit normalized or generated values such as an artifact path.

## Registration and definitions

At startup, `createDurableScheduler`:

1. creates a deployment record;
2. compiles each workflow to a manifest;
3. computes its definition hash;
4. stores the definition;
5. marks it active for that workflow ID;
6. builds the source-loaded step registry when a run begins.

Historical definitions remain in SQLite. The dashboard starts only the latest visible definition, while old runs continue to reference their original hashes.

## Trigger execution

The current facade drives a newly triggered run synchronously:

```text
HTTP request
  → create run
  → materialize nodes
  → tick ready work until no work remains
  → update run status
  → return response
```

Consequences:

- a slow agent task keeps the request open;
- work currently executes sequentially within the scheduler tick loop, even when topology branches are independent;
- the database remains authoritative, but `createDurableScheduler` is not yet a standalone background worker supervisor.

Moving run execution behind a queue/alarm and returning `202 Accepted` immediately is future runtime work.

## Dependencies and input propagation

Static materialization creates one instance per manifest task. Roots are `ready`; dependency targets are `pending`.

After a task completes, `promoteReady(runId)`:

- checks that every durable dependency completed;
- copies the predecessor output into the dependent input;
- changes eligible pending nodes to `ready`.

For fan-in with several parents, input aggregation must be modeled explicitly. The current local promotion path copies one dependency output rather than constructing a named aggregate. Prefer static `fanout` for independent terminal branches and test any custom fan-in topology carefully.

## Claims and leases

A ready instance is atomically claimed before execution:

```text
ready/retry_wait → running
attempt += 1
leaseExpiresAt = now + lease duration
```

The default lease is 60 seconds. `DurableTaskScheduler.recover(now)` returns expired running work to retryable state through the database adapter.

Recovery primitives exist, but the high-level local facade does not yet automatically scan and resume every incomplete historical run on process startup. A production host should own a scheduler loop that:

1. loads compatible definitions and registries;
2. calls `recover`;
3. ticks until no eligible work remains;
4. updates aggregate run state.

## Local data lifecycle

Development reset:

```bash
rm -rf .clank
```

This removes runs, definitions, deployment metadata, events, and content-addressed artifacts under the default root. Plain files generated by examples may live elsewhere and must be removed separately.

Do not delete `.clank` in a real environment unless losing all scheduler history is intentional.

## SQLite inspection

For local debugging:

```bash
sqlite3 .clank/scheduler.sqlite ".tables"
sqlite3 .clank/scheduler.sqlite \
  "select run_id, status, created_at from workflow_runs order by created_at desc;"
sqlite3 .clank/scheduler.sqlite \
  "select node_id, status, attempt from node_instances where run_id='<run-id>';"
```

Prefer the operational API for applications; direct SQL is a development and incident-response tool.
