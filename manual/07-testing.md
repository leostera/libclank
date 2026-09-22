# Testing your workflows

Test a LibClank application at two levels:

1. task tests for individual business operations;
2. workflow tests using the real scheduler and a temporary SQLite database.

Keep model, network, browser, and operating-system behavior behind deterministic test doubles.

## Test a task directly

A task's `execute` method returns an Effect:

```ts
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Id, Task } from "@libclank/core"

const normalize = Task.fn<string, string>({
  id: Id.task("normalize"),
  run: (value) => Effect.succeed(value.trim().toLowerCase()),
})

describe("normalize", () => {
  it("normalizes a value", async () => {
    const output = await Effect.runPromise(normalize.execute("  HELLO  "))
    expect(output).toBe("hello")
  })
})
```

Use this level for business rules, schema behavior, and task-specific failures.

## Test a complete durable workflow

Use the real local database in a temporary directory and invoke the real HTTP route:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { createTriggerApp } from "@libclank/cloudflare"
import { Id, SchedulerObservers, Task, Triggers } from "@libclank/core"
import { createLocalSchedulerDatabase } from "@libclank/local"
import { createDurableScheduler } from "@libclank/scheduler"

const Input = Schema.Struct({ value: Schema.Number })

describe("double workflow", () => {
  it("executes and persists every step", async () => {
    const directory = await mkdtemp(join(tmpdir(), "my-workflow-"))
    const database = createLocalSchedulerDatabase(join(directory, "scheduler.sqlite"))

    try {
      const trigger = Triggers.webhook<{ value: number }>({
        id: Id.trigger("input"),
        path: "/hooks/input",
        decode: async (request) => Schema.decodeUnknownPromise(Input)(await request.json()),
      })

      const double = Task.fn({
        id: Id.task("double"),
        run: ({ value }: { value: number }) => Effect.succeed({ value: value * 2 }),
      })

      const workflow = trigger.then(double)
      const scheduler = await createDurableScheduler({
        workflows: [workflow],
        database,
        observer: SchedulerObservers.noop,
      })

      const response = await createTriggerApp(scheduler).fetch(
        new Request("http://test/hooks/input", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: 21 }),
        }),
      )

      expect(response.status).toBe(200)

      const runs = await database.listRuns?.()
      expect(runs).toHaveLength(1)
      expect(runs?.[0]?.status).toBe("completed")

      const nodes = await database.getNodes?.(runs![0]!.id)
      expect(nodes?.every((node) => node.status === "completed")).toBe(true)
      expect(nodes?.some((node) => JSON.stringify(node.output) === JSON.stringify({ value: 42 }))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
```

This catches problems that a task-only test cannot:

- trigger decoding;
- graph compilation;
- dependency input propagation;
- task registration;
- persisted state;
- event ordering.

## Decode HTTP responses in tests

Treat your own API responses as external data too:

```ts
const TriggerResponse = Schema.Struct({
  triggerId: Schema.String,
  runs: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
    }),
  ),
})

const value = await Schema.decodeUnknownPromise(TriggerResponse)(await response.json())
```

Avoid unchecked casts in application tests.

## Test fan-out

For a graph like:

```text
source
  ├→ topic → shared-open
  └→ style → shared-open
```

Assert:

- both branch tasks receive the source output;
- both shared-task call sites exist independently;
- each shared task receives its own branch output;
- no branch starts before the source completes;
- the final run has no pending instances.

Reusing the same task in several branches is intentional and should be part of your test suite.

## Test failures

Use deterministic failures:

```ts
const fail = Task.fn<number, number>({
  id: Id.task("fail"),
  run: () => Effect.fail(new Error("expected failure")),
})
```

Check both the returned run and persisted data:

```text
run.status = failed
node.status = failed
node.error contains the task identity and cause
node.failed event exists
workflow.completed has failed status
```

## Test retries and idempotency

A retry test should verify:

- attempt count increases;
- the original persisted input is reused;
- a successful prior node is not re-executed;
- an external side effect is not duplicated unexpectedly.

Use a fake endpoint that fails a known number of times instead of relying on timing or a live service.

## Test process restart

For workflows that depend on recovery, include an application-level restart test:

1. start a run using a temporary SQLite file;
2. allow some work to complete;
3. discard the first scheduler/database objects;
4. reopen the same SQLite file;
5. load the same workflow source;
6. recover expired work;
7. finish the run;
8. assert completed work did not run twice.

The exact supervisor loop is application/runtime specific today, so test the recovery loop you deploy.

## Replace agent endpoints, not workflow structure

Keep your real `Task.agent` graph but inject a deterministic endpoint:

```ts
const fakeEndpoint: AgentEndpoint = {
  run: (request) =>
    Effect.succeed({
      title: "Test title",
      summary: `Summary for ${JSON.stringify(request.input)}`,
    }),
}
```

This preserves task IDs, graph topology, and scheduler behavior without calling a model.

Run real Pi/model tests separately, behind an opt-in environment variable and with isolated output directories.
