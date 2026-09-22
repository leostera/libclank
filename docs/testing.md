# Testing behavior

This document distinguishes behavior exercised today from planned durable-runtime guarantees. The authoritative roadmap is [RFD0002](./rfds/RFD0002-durable-runtime-correctness.md) and its [implementation checklist](../.agents/plans/RFD0002-implementation-checklist.md).

## Current test layers

- `packages/core`: fast node-composition and eager scheduler unit tests.
- `packages/scheduler`: manifest, topology, dynamic materialization, retry, and event-store unit tests.
- `packages/local`: real local SQLite persistence and restart tests.
- `packages/cloudflare`: Durable Object-compatible prototype tests.
- `apps/scheduler`: `@cloudflare/vitest-pool-workers` Worker-emulator tests with Durable Objects, SQLite, and service bindings.
- `tests/e2e`: real local SQLite/Hono integration tests using deterministic task doubles.

External model, MCP, GitLab, arXiv, and filesystem-viewer calls must not be used in deterministic tests.

## Behavior exercised today

### Eager core graph execution

- A trigger selects workflows that depend on it.
- `oneOf` selects the trigger that fired.
- `then` passes one typed output to the next node.
- `map` transforms one completed output.
- `mapEach` and `fanout` run their eager Effect branches.
- A failed eager node prevents its downstream eager execution.

### Local durable scheduler foundation

- A trigger creates a persisted run with an opaque `RunId`.
- Static node instances, inputs, outputs, failures, and lifecycle events persist in SQLite.
- Restarting a completed local run does not re-execute completed node instances.
- Leases and retry-wait state exist in the local database.
- Durable execution applies each task's declared maximum attempts and static retry backoff.
- Invalid persisted inputs/outputs and permanent AgentRuntime responses fail without retrying; other unclassified failures remain retryable while attempts remain.
- Cacheable tasks derive and persist an execution key from the validated input, artifacts, workflow definition, and task definition; a matching completed local result is reused.
- Dynamic `mapEach` item instances have a persisted execution foundation.
- Input and output schemas are validated at the durable execution boundary when supplied.

### Cloudflare prototype

- A scheduler Worker can route a request to a per-run Durable Object.
- The example Scheduler-to-AgentRuntime path uses a service binding.
- The example Durable Object persists a simple run trace in SQLite.

## Planned guarantees — do not rely on these yet

The following are RFD0002 work items, not current end-to-end guarantees:

- idempotent duplicate trigger delivery;
- asynchronous durable trigger submission that returns before workflow completion;
- richer external-task failure classifications beyond retryable, permanent, and unknown;
- cache-safe Agent executor identity, cached `undefined` output handling, and cache-hit events;
- monotonic per-run event sequencing;
- transactional claim/completion operations and stale-claim rejection;
- explicit graph-manifest semantics independent of generated ID suffixes;
- durable bounded `forEach` and fan-out execution;
- equivalent local SQLite and Cloudflare Durable Object scheduler lifecycles;
- lifecycle commands, timeouts, cancellation, and pause/resume;
- Agent protocol authentication, runtime schemas, and execution-token deduplication.

## Commands

```bash
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run build
bun run test:unit
bun run test:e2e
bun run test:workers
# Equivalent full suite:
bun run test
```

The Worker test command is separate because it uses its own Vitest configuration and the Cloudflare Workers emulator.
