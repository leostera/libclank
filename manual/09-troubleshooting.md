# Troubleshooting

## A task receives `undefined` fields

Example:

```text
Could not open undefined
undefined is not an object (evaluating 'sourcePath.replace')
```

First inspect the run's persisted node inputs:

```http
GET /api/runs/:runId/nodes
```

Common causes:

1. The trigger decoder generated a field, but an API/dashboard start bypassed that decoder.
2. A lightweight `.map` transformation was used where a durable named task was required.
3. A dependency edge is missing because IDs were reused incorrectly.
4. An upstream task returned a shape that was not validated.

Fixes:

- route every raw start input through the trigger decoder;
- use input/output schemas;
- use `Task.fn` for durable transformations;
- give every task a stable ID;
- add a workflow test that asserts each persisted input.

## Dashboard starts differ from webhook starts

`createTriggerApp` automatically calls `trigger.decode`. A custom dashboard operation calls `scheduler.runTrigger` directly and must invoke the decoder itself.

Use one application helper for all programmatic starts:

```ts
async function invokeTrigger(triggerId: string, rawInput: unknown) {
  const id = Id.trigger(triggerId)
  const trigger = scheduler.triggers.find((item) => item.id === id)
  if (!trigger) throw new Error(`Unknown trigger: ${triggerId}`)

  const input = trigger.decode
    ? await trigger.decode(
        new Request("http://local.invalid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(rawInput),
        }),
      )
    : rawInput

  return scheduler.runTrigger(id, input)
}
```

## Old failed runs reappear

Runs and workflow definitions survive process restarts in `.clank/scheduler.sqlite`. Restarting the server does not erase history.

For disposable local development state:

```bash
rm -rf .clank
```

Do not do this in an environment whose history matters.

## A run created before a topology fix is still broken

Every run references the definition hash active when it was created. Registering corrected source creates a new definition; it does not rewrite old runs.

Start a new run. Keep the old run as historical evidence, or reset local state if it is disposable.

## `Task <id> is not registered in this deployment`

The database contains a `stepId` that the loaded workflow source cannot resolve.

Check that:

- the same workflow is registered on restart;
- task IDs did not change;
- reused task call sites still compose in the same structure;
- the run's historical definition is compatible with this deployment;
- all branch implementations are included in the root workflow.

Do not work around this by executing an arbitrary task with a similar name. Resume requires exact identity.

## A run reports incomplete step instances

This means the scheduler reached a point where no eligible work remained, but at least one node was not completed.

Inspect:

```http
GET /api/runs/:runId/nodes
GET /api/runs/:runId/events
```

Look for:

- pending nodes with a failed dependency;
- retry-wait nodes whose retry time has not arrived;
- running nodes with an unexpired or abandoned lease;
- dynamic fan-out parent/child instances;
- a task implementation missing from the registry.

## Pi says it wrote `undefined`

The output path was not present in task input. Generate a path before invoking the agent and make it part of the typed request:

```ts
return {
  url,
  path: join(outputDirectory, `${crypto.randomUUID()}.md`),
}
```

Then make the prompt use `input.path` and verify it with `fileOutput`.

Delete any accidental file created literally as `undefined`:

```bash
rm -f undefined
```

## Pi completed but the workflow says the artifact is missing

`fileOutput` checks the exact path passed to it. Confirm:

- the prompt includes the same absolute path;
- the agent used tools to write rather than only printing content;
- the process has permission to create the parent directory;
- the `output` callback receives the same input used by the prompt;
- relative paths are resolved from the expected working directory.

Prefer absolute paths in local agent workflows.

## The OS could not open a generated file

The artifact may still be valid even if `open`, `start`, or `xdg-open` failed.

For convenience-only behavior:

```ts
openFile({
  id: Id.node("open-report"),
  required: false,
})
```

This keeps an OS viewer failure from failing the run.

## The HTTP request takes a long time

The current local durable scheduler drives a newly triggered run synchronously. Agent tasks can keep the request open for minutes.

This is expected for the current facade. Put a reverse-proxy timeout above the maximum task duration only if you understand that closing the client connection does not provide a complete cancellation mechanism.

## The dashboard does not update immediately

The dashboard polls rather than streams:

- run list every 5 seconds;
- run graph and logs every 2 seconds.

Wait for the next interval and inspect the API directly if needed.

## Dynamic items do not appear separately in the graph

Dynamic instances are persisted but the visual graph is still primarily manifest-based. Inspect:

```http
GET /api/runs/:runId/nodes
```

Each dynamic instance has its own instance ID and input.

## Vite warns about `"use client"`

You may see:

```text
[MODULE_LEVEL_DIRECTIVE] The semantics of "use client" may not be preserved
```

This comes from bundling React Flow. It is currently a warning, not a runtime failure.

You may also see a bundle-size warning because React Flow contributes to a large client chunk. It does not prevent the dashboard from running.

## Port already in use

Change the Bun server port or stop the previous process:

```bash
lsof -i :8789
```

## Native `better-sqlite3` installation fails

Confirm that:

- your Bun/Node ABI and platform are supported;
- native build tools are installed;
- dependencies were installed for the current architecture;
- a copied `node_modules` directory is not from another operating system.

Reinstall dependencies on the target machine rather than copying native modules.
