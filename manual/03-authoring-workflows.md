# Authoring workflows

Workflow authoring happens entirely in TypeScript. Compose typed nodes, then hand the resulting root node to a scheduler.

## Define tasks

### Pure or value-producing tasks

`Task.fn` accepts a function returning an Effect:

```ts
import { Effect, Schema } from "effect"
import { Id, Task } from "@libclank/core"

const ParseInput = Schema.Struct({ text: Schema.String })
const Parsed = Schema.Struct({ words: Schema.Array(Schema.String) })

type ParseInput = Schema.Schema.Type<typeof ParseInput>
type Parsed = Schema.Schema.Type<typeof Parsed>

const parse = Task.fn<ParseInput, Parsed>({
  id: Id.task("parse-text"),
  description: "Split text into words",
  version: "1",
  input: ParseInput,
  output: Parsed,
  run: ({ text }) => Effect.succeed({ words: text.split(/\s+/) }),
})
```

### Side-effect tasks

Use `Task.effect` when the next workflow value should be `void`:

```ts
const audit = Task.effect<{ message: string }>({
  id: Id.task("write-audit-record"),
  run: ({ message }) =>
    Effect.tryPromise({
      try: () => writeAuditRecord(message),
      catch: (error) => new Error(`Audit failed: ${String(error)}`),
    }),
})
```

If a side effect should observe a value without replacing it, compose it with `tap` instead.

## Validate task boundaries

Durable inputs come from JSON, a database, another task, or an external agent. Add schemas at important boundaries:

```ts
const enrich = Task.fn<Input, Output>({
  id: Id.task("enrich"),
  input: InputSchema,
  output: OutputSchema,
  run: (input) => doEnrichment(input),
})
```

The durable executor decodes input before execution and validates output before persistence. A schema failure is recorded as a task failure.

## Triggers

### Webhook

```ts
const Body = Schema.Struct({ url: Schema.String })
type RequestInput = { readonly url: string; readonly path: string }

const trigger = Triggers.webhook<RequestInput>({
  id: Id.trigger("summarize-url"),
  path: "/hooks/summarize-url",
  decode: async (request) => {
    const body = await Schema.decodeUnknownPromise(Body)(await request.json())
    new URL(body.url)
    return { url: body.url, path: makeOutputPath() }
  },
})
```

The decoder is the HTTP trust boundary. It can validate, normalize, authenticate, and add generated values.

### Manual

```ts
const trigger = Triggers.manual({
  id: Id.trigger("refresh-index"),
})
```

Manual triggers have no value and default to `/run/<trigger-name>` when mounted through `createTriggerApp`.

### Cron

```ts
const trigger = Triggers.cron({
  id: Id.trigger("nightly-report"),
  schedule: "0 2 * * *",
  value: { period: "previous-day" },
})
```

The trigger definition stores the schedule. The hosting runtime is responsible for invoking scheduled triggers.

## Composition operators

### `then`: pass output forward

```ts
const workflow = trigger.then(fetchDocument).then(summarizeDocument)
```

```text
trigger output → fetchDocument → summarizeDocument
```

Prefer passing a named `Task` to `then` in durable workflows. The callback overload is convenient for eager execution, but named tasks give transformations stable IDs, schemas, retry boundaries, and persisted outputs.

### `tap`: perform work and preserve the value

```ts
const workflow = trigger.then(writeReport).tap(openReport)
```

`openReport` receives the report output, but the composed node preserves the report as its logical output.

A reused tap task receives a unique call-site `stepId` in each branch.

### `map`: lightweight value transformation

```ts
const urls = discover.map((links) => links.map((link) => link.url))
```

`map` is useful with the eager in-memory scheduler. It is not currently materialized as its own durable step. For durable workflows, use a named `Task.fn` when the transformation must affect persisted downstream input:

```ts
const selectUrls = Task.fn<readonly Link[], readonly string[]>({
  id: Id.task("select-urls"),
  run: (links) => Effect.succeed(links.map((link) => link.url)),
})

const urls = discover.then(selectUrls)
```

### `fanout`: static named branches

```ts
const workflow = trigger.then(fetchMarkdown).fanout({
  topic: analyzeTopic.tap(openAnalysis),
  style: analyzeStyle.tap(openAnalysis),
  confidence: analyzeConfidence.tap(openAnalysis),
})
```

Every branch receives the same parent output:

```text
fetchMarkdown
  ├→ analyzeTopic → openAnalysis
  ├→ analyzeStyle → openAnalysis
  └→ analyzeConfidence → openAnalysis
```

The eager scheduler returns an object keyed by branch name. The durable scheduler persists branch tasks and branch-specific dependencies. Static fan-out is covered by SQLite E2E tests.

### `mapEach`: one task per item

```ts
const workflow = trigger.then(discoverLinks).mapEach(summarizeLink)
```

The durable design uses a static template and creates one runtime instance per item. Dynamic fan-out support is still being hardened; use deterministic item values and test restart behavior for your workflow before relying on it in production.

### `forEach`: source-defined per-item subgraphs

```ts
const workflow = trigger.then(discoverItems).forEach((item) => item.then(processItem))
```

`forEach` is currently most suitable for eager workflows. Prefer `mapEach` for the durable collection execution path.

### `Workflow.oneOf`: multiple possible triggers

```ts
const start = Workflow.oneOf([webhookTrigger, manualTrigger])
const workflow = start.then(processInput)
```

The active trigger is selected from the execution context.

### `Workflow.all`: run independent roots

```ts
const workflow = Workflow.all({
  customers: loadCustomers,
  invoices: loadInvoices,
})
```

This eagerly runs all branches and returns named outputs. Durable multi-root semantics are not yet the recommended path; model required durable dependencies explicitly with tasks and edges.

## Retry and cache metadata

Tasks can declare metadata:

```ts
const fetch = Task.fn<Input, Output>({
  id: Id.task("fetch"),
  cache: "by-input",
  retry: { maxAttempts: 3, backoffMs: 1_000 },
  run: fetchEffect,
})
```

Use `by-input` only when output is immutable and reusable for equivalent input. Agent tasks default to `by-input`.

The current durable execution loop has scheduler-level retry behavior, while complete per-task retry-policy enforcement and execution-key plumbing are still evolving. Treat task metadata as part of the durable definition, but test the exact runtime policy you depend on.

## Error handling

Let failures remain typed Effect failures where possible:

```ts
const fetch = Task.fn<Request, Response>({
  id: Id.task("fetch"),
  run: (request) =>
    Effect.tryPromise({
      try: () => fetchRemote(request),
      catch: (cause) => new FetchError({ cause }),
    }),
})
```

The node wrapper records a `NodeExecutionError` with the node ID and underlying cause. The scheduler serializes that error before persistence.

## Authoring rules of thumb

1. Give every durable operation a named task.
2. Keep IDs stable after deployment.
3. Decode external input at triggers and task schemas.
4. Return JSON-serializable outputs or explicit artifact references.
5. Make side effects idempotent when retries are possible.
6. Use `tap` for ancillary work that receives but does not replace a value.
7. Test reused tasks in multiple branches; call-site identity matters.
8. Avoid relying on in-memory closure state across task attempts.
