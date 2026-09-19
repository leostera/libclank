# Cloudflare durable agent slice

## Goal

Deliver one complete, Cloudflare-native path:

```text
POST /run/:trigger
  -> Scheduler Worker
  -> WorkflowRun Durable Object
  -> team-owned AgentRuntime service binding
  -> persisted SQLite run trace
  -> GET /runs/:runId and /runs/:runId/events
```

The trigger endpoint returns `202 Accepted` with a `runId`; it does not wait for execution.

## Scope

This slice supports a manual-triggered, sequential workflow containing deterministic tasks and `Task.agent` tasks. It deliberately excludes dynamic `forEach`/fanout materialization, cron, retries, streaming, cancellation, and real model/MCP integration.

## Contracts

1. Add versioned agent request/result contracts to `@libclank/agent`:
   - `runId`, `nodeId`, `attempt`, input, instructions;
   - JSON output or a structured error;
   - `POST /task` as the initial transport.
2. Preserve opaque IDs, but validate definition URI construction and use UUIDs only for runtime IDs.
3. Make the scheduler persist an append-only event stream with sequence numbers.

## Runtime

1. Replace eager request-bound scheduler execution with a durable workflow plan/run model.
2. Add `WorkflowRunDO` to `@libclank/cloudflare`.
3. Persist run metadata, node state, and events in DO SQLite.
4. The Scheduler Worker creates a named Run DO, starts it, and exposes inspection endpoints.
5. The Run DO executes each ready node, records state/events around every call, and invokes agent tasks through the configured service binding.

## Agent runtime

1. Make `apps/agent` implement LibClank's `POST /task` protocol.
2. Initially implement a deterministic fake runtime, including an intentional failure mode for tests.
3. Keep the app team-owned in shape; model, MCP, and tool implementation are a later replacement behind the same protocol.

## Tests

Add `@cloudflare/vitest-pool-workers` integration tests covering:

- trigger creates a run and returns 202;
- run and node events persist in the Run DO;
- scheduler -> AgentRuntime service binding dispatch;
- success and failure terminal states;
- inspection routes survive a subsequent request;
- duplicate delivery with an idempotency key returns the original run.

Use no external model, MCP, GitLab, or network calls.

## Delivery order

1. Configure the Bun workspace and Workers test pool.
2. Implement the agent protocol and deterministic runtime.
3. Implement the durable workflow plan and Run DO.
4. Implement Worker routes and service binding dispatch.
5. Add emulator integration tests.
6. Add alarms/recovery, retries, and dynamic fanout only after this slice is green.

## Acceptance criteria

`bun run build`, `bun run typecheck`, and `bun run test` pass. A local Worker-pool test proves that a manual request is accepted, its agent task is dispatched through a service binding, and its persisted trace can be read after completion.
