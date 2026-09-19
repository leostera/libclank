# Testing behavior

## Graph semantics

- A trigger starts only workflows that depend on it.
- `oneOf` accepts whichever trigger fired.
- `all` waits for every input and fails when one input fails.
- `then` passes one typed output to the next node.
- `map` transforms one completed output into another shape.
- `mapEach` transforms every item in a completed collection.
- `forEach` expands a collection into independently executable branches.
- `fanout` runs named branches from the same value and returns named outputs.
- A failed node prevents downstream nodes from running.

## Scheduler semantics

- Trigger receipt creates a run with an opaque `RunId`.
- Scheduling and node lifecycle events are emitted in order.
- Results and failures are persisted.
- Best-effort workflows allow independent branches to finish.
- Total workflows fail when required work does not complete.
- Retry policies create distinct attempts and preserve prior failures.
- Timeouts and cancellation produce terminal events.
- Duplicate trigger delivery is idempotent.

## Cloudflare runtime semantics

- Worker routes dispatch to the correct run Durable Object.
- A run DO persists graph state and events in SQLite.
- Alarms resume queued work after the request ends.
- Concurrent requests to one run do not corrupt state.
- Different run DOs can execute concurrently.
- Scheduler-to-AgentRuntime service bindings carry typed task requests.
- Agent events and failures are persisted with the workflow trace.

## Test layers

- `packages/core`: fast graph/scheduler unit tests.
- `packages/scheduler`: event-store and policy tests.
- `packages/cloudflare`: Workers integration tests.
- `apps/*`: `@cloudflare/vitest-pool-workers` emulator tests with DOs, SQLite, alarms, and service bindings.
- External model, MCP, GitLab, and arXiv calls are never used in deterministic tests.
