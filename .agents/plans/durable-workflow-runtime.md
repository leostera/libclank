# Durable artifacts, workflow manifests, cache keys, and scheduler runtime

## Goal

Before building `@libclank/ui`, make workflow execution durable, reproducible, and cacheable in local Bun and Cloudflare Durable Object runtimes.

## Boundaries

- Workflow/task/agent authoring remains source code only.
- The UI will only operate on persisted definitions, runs, events, and artifacts.
- Artifacts are immutable, content-addressed values; task outputs should exchange `ArtifactRef`s rather than local paths.
- Schedulers provide at-least-once execution. Side effects require idempotency keys; result caching is only for explicitly cacheable work.

## 1. `@libclank/artifacts`

Create a portable package containing:

- `ArtifactRef`, `ArtifactId`, `ArtifactDigest`, metadata, and `Artifacts` interface;
- SHA-256 digest/canonical byte helpers using Web Crypto;
- immutable content-addressed behavior;
- local backend in `@libclank/local` with default root `<cwd>/.clank/artifacts/sha256/...`;
- Cloudflare backend in `@libclank/cloudflare` backed by platform bindings.

Tests: stable digest, deduplication, round trip, metadata, configurable local root.

## 2. Source-defined workflow manifests

Add manifest types/compiler in `@libclank/core`:

- workflow definition ID and deterministic definition hash;
- node definitions, kinds, dependencies, trigger references, and cache policy;
- agent definition/version references;
- canonical serialization.

Manifests are deployment/runtime metadata. They are not executable workflow authoring artifacts.

## 3. Scheduler database and run state machine

Expand `@libclank/scheduler` with a storage abstraction and SQLite schema:

- registered workflow manifests/definition hashes;
- runs and idempotency keys;
- node instances, dependency state, inputs, outputs, attempts, leases, and events;
- artifact references and execution-key cache index.

Implement state transitions:

```text
pending -> ready -> running -> completed
                         -> retry_wait -> ready
                         -> failed / cancelled
```

Persist a state transition before/after every external task invocation. Persist output artifacts before completing a node.

## 4. Local durable scheduler

Implement `@libclank/local` SQLite driver and scheduler loop:

- default DB: `<cwd>/.clank/scheduler.sqlite`;
- register manifests at startup;
- scan ready and overdue retry nodes;
- timers are advisory; DB is the source of truth;
- reconcile expired execution leases after process restart;
- resume only matching workflow definition hashes, otherwise block the run.

## 5. Cloudflare durable scheduler

Implement equivalent state machine using Run Durable Object SQLite:

- Worker/Scheduler facade handles trigger routing and idempotency;
- RunDO owns one run's node state, events, retries, and alarm wakeups;
- platform artifact backend persists content and metadata;
- execution state semantics match the local runtime.

## 6. Execution keys and reuse

For cacheable nodes:

```text
sha256(definition hash + node hash + canonical input + input artifact digests + agent hash)
```

On a hit, reuse immutable output `ArtifactRef`s and emit `node.cache_hit`/`node.completed` events. Default agent/effect cache policy is `never`; deterministic functions may opt in. Side effects use idempotency keys, never result caching.

## Acceptance criteria before UI

- Local URL examples persist their source/output artifacts below `.clank` and return artifact references.
- Stopping/restarting the local scheduler resumes incomplete retryable runs from SQLite.
- Identical cacheable executions reuse artifact outputs and report a cache hit.
- Workers emulator proves RunDO persistence, retry/alarm resumption, and artifact-backed results.
- A source workflow manifest/version is recorded for every run.
