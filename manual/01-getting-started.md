# Getting started

This chapter creates a small durable LibClank application with a webhook, two typed tasks, and local SQLite persistence.

## Install the packages

A local durable application uses these packages:

```bash
bun add \
  @libclank/core \
  @libclank/scheduler \
  @libclank/local \
  @libclank/cloudflare \
  effect hono
```

If you consume LibClank from a monorepo before public packages are available, declare the same packages as workspace dependencies:

```json
{
  "dependencies": {
    "@libclank/core": "workspace:*",
    "@libclank/scheduler": "workspace:*",
    "@libclank/local": "workspace:*",
    "@libclank/cloudflare": "workspace:*",
    "effect": "4.0.0-rc.116",
    "hono": "^4.13.8"
  }
}
```

Use ESM (`"type": "module"`) and strict TypeScript settings.

## Write your first workflow

Create `src/server.ts`:

```ts
import { Effect, Schema } from "effect"
import { createTriggerApp } from "@libclank/cloudflare"
import { Id, Task, Triggers } from "@libclank/core"
import { createConsoleObserver, createLocalSchedulerDatabase } from "@libclank/local"
import { createDurableScheduler } from "@libclank/scheduler"

const Input = Schema.Struct({ value: Schema.Number })
type Input = Schema.Schema.Type<typeof Input>

const Doubled = Schema.Struct({ value: Schema.Number })
type Doubled = Schema.Schema.Type<typeof Doubled>

const trigger = Triggers.webhook<Input>({
  id: Id.trigger("double"),
  path: "/hooks/double",
  decode: async (request) => Schema.decodeUnknownPromise(Input)(await request.json()),
})

const double = Task.fn<Input, Doubled>({
  id: Id.task("double-value"),
  description: "Double a number",
  input: Input,
  output: Doubled,
  run: ({ value }) => Effect.succeed({ value: value * 2 }),
})

const format = Task.fn<Doubled, string>({
  id: Id.task("format-result"),
  input: Doubled,
  output: Schema.String,
  run: ({ value }) => Effect.succeed(`result:${value}`),
})

const workflow = trigger.then(double).then(format)

const database = createLocalSchedulerDatabase()
const scheduler = await createDurableScheduler({
  workflows: [workflow],
  database,
  observer: createConsoleObserver(),
})

const app = createTriggerApp(scheduler)
Bun.serve({ port: 8789, fetch: app.fetch })

console.log("Listening on http://localhost:8789")
```

Run it:

```bash
bun src/server.ts
```

Trigger the workflow:

```bash
curl -X POST http://localhost:8789/hooks/double \
  -H 'content-type: application/json' \
  --data '{"value":21}'
```

The response contains a completed run whose output is:

```text
result:42
```

## What each part does

### Trigger

```ts
Triggers.webhook(...)
```

Defines the route that starts the workflow and decodes untrusted HTTP input into the workflow's typed input.

### Tasks

```ts
Task.fn(...)
```

Defines named units of work. Each task receives the previous task's output and returns an Effect.

### Composition

```ts
trigger.then(double).then(format)
```

Builds this graph:

```text
webhook → double-value → format-result
```

TypeScript checks that each output can be passed to the next input.

### Durable scheduler

```ts
createDurableScheduler(...)
```

Registers the workflow and persists run and task state in SQLite. By default, local state lives at:

```text
.clank/scheduler.sqlite
```

### HTTP adapter

```ts
createTriggerApp(scheduler)
```

Creates a Hono application with routes for all registered webhook and manual triggers, plus `/health`.

## Add the dashboard

Install the UI package:

```bash
bun add @libclank/ui
```

Then follow [Dashboard and operations](06-dashboard-and-operations.md) to serve the graph, runs, and logs from the same application.

## Try the complete examples

When working from the LibClank repository:

```bash
bun run example:url-summary
bun run example:link-digest
bun run example:parallel-analyses
```

The parallel-analysis example is the most complete local application. It includes durable SQLite execution, three analysis branches, a dashboard, and run logs.

## Next

Read [Mental model](02-mental-model.md), then [Authoring workflows](03-authoring-workflows.md).
