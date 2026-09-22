# RFD0002 Implementation Checklist

## Status

In Progress — Milestone 0 completed on 2026-09-22.

## Goal

Implement the shared, correctness-oriented durable scheduler defined by [RFD0002 - Durable Runtime Correctness and Unification](../../docs/rfds/RFD0002-durable-runtime-correctness.md) across local SQLite and Cloudflare Durable Objects. The RFD is authoritative when design and checklist wording differ.

## Context and scope

The current repository has typed workflow composition, manifests, a local SQLite scheduler, and Cloudflare prototypes, but its execution paths do not yet share one lifecycle contract. This plan covers transactional state transitions, idempotent asynchronous submission, policy enforcement, explicit graph manifests, bounded dynamic work, Cloudflare runtime unification, and Agent protocol hardening. UI lifecycle controls, event streaming, and artifact provenance remain outside this plan except where compatibility changes are required.

## Delivery priority

The user selected this implementation order on 2026-09-22:

1. **Milestone 2 — idempotent asynchronous submission.** Start with only the minimal additive storage migration needed for trigger identity, input digest, and uniqueness; defer broad event/claim storage hardening.
2. **Milestone 5 — durable bounded dynamic work.** Implement persisted bounded fan-out after submission has a durable asynchronous lifecycle.
3. **Milestone 6 — Cloudflare runtime unification.** Implement the shared lifecycle over per-run Durable Object SQLite after local submission and fan-out semantics are defined.
4. **Remaining work.** Return to Milestone 1 storage hardening, then graph manifest v2, residual cache work, Agent boundary hardening, and cleanup in dependency order.

## Working rules

- Land each milestone with tests and without leaving `main` unable to build.
- Prefer additive schema/API changes before removing old paths.
- Run local SQLite and Durable Object conformance tests for shared lifecycle changes.
- Update the RFD if implementation changes an agreed contract.
- Do not claim exactly-once execution for external side effects.

## Milestone 0 - Baseline and toolchain

- [x] Choose Bun or pnpm as the repository package manager and align `README.md`, `package.json`, lockfiles, and CI.
- [x] Add CI for install, format check, typecheck, build, unit tests, E2E tests, and Worker tests.
- [x] Record existing public exports and fixture representative workflows for compatibility tests.
- [x] Add a shared test helper that runs a workflow through both the eager core scheduler and durable local scheduler where semantics should match.
- [x] Update `docs/testing.md` to mark currently unimplemented guarantees as planned until their milestone lands.

Validation:

```bash
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run test
```

## Milestone 1 - Ordered events and transactional database operations

> Broad storage hardening is deferred. The user selected Milestone 2 first on 2026-09-22; implement only its minimal additive idempotency migration before returning to this milestone's event sequencing, claim tokens, and transactional lifecycle work.

Affected areas:

- `packages/scheduler/src/database.ts`
- `packages/scheduler/src/run-state.ts`
- `packages/scheduler/src/sqlite-schema.ts`
- `packages/scheduler/src/migrations.ts`
- `packages/local/src/scheduler-database.ts`

- [ ] Add per-run event `sequence` and `createdAt` to the event contract.
- [ ] Migrate local SQLite to assign monotonic event sequence transactionally.
- [ ] Read events by sequence rather than timestamp.
- [ ] Add claim tokens that identify node instance, attempt, and lease.
- [ ] Replace correctness-sensitive primitive database calls with coarse transactional operations:
  - [ ] `createOrGetRun`
  - [ ] `claimReadyNodes`
  - [ ] `completeNode`
  - [ ] `failNode`
  - [ ] `recoverExpired`
  - [ ] `reconcileRun`
- [ ] Enforce legal node transitions inside database operations.
- [ ] Reject stale completion from an expired claim.
- [ ] Add `node.lease_expired` and retry-decision events.
- [ ] Provide database disposal/close support for local runtimes and tests.

Tests:

- [ ] same-millisecond events retain commit order;
- [ ] two claimers cannot own one attempt;
- [ ] stale completion cannot overwrite a later attempt;
- [ ] expired running nodes recover;
- [ ] completion atomically stores output, event, promotions, and run state;
- [ ] reopening SQLite preserves state and sequence.

## Milestone 2 - Idempotent submission and asynchronous scheduler API

Affected areas:

- `packages/core/src/scheduler.ts`
- `packages/scheduler/src/trigger-scheduler.ts`
- `packages/scheduler/src/operations.ts`
- `packages/cloudflare/src/index.ts`
- local example servers

- [ ] Add `TriggerOptions`, `RunSubmission`, and `TickResult` public types.
- [ ] Add `submitTrigger` and run-scoped `tick` APIs.
- [ ] Preserve `runTrigger` as a synchronous local/testing convenience wrapper.
- [ ] Persist `triggerId`, nullable `idempotencyKey`, and canonical input digest on runs.
- [ ] Add unique storage enforcement for keyed submissions.
- [ ] Return an existing run for the same key and input.
- [ ] Return typed `IdempotencyConflict` for the same key and different input.
- [ ] Enforce idempotency per `(workflowId, triggerId, key)` and return one deduplicated submission per matching workflow.
- [ ] Change hosted Hono trigger routes to return `202` after durable submission.
- [ ] Expose run-location/status links in trigger responses where an operations API is available.
- [ ] Ensure retries waiting for time do not mark a run failed.

Tests:

- [ ] duplicate sequential submission;
- [ ] duplicate concurrent submission;
- [ ] conflicting duplicate payload;
- [ ] unkeyed identical payload creates distinct runs;
- [ ] hosted handler returns before task completion;
- [ ] synchronous wrapper drains deterministic local work.

## Milestone 3 - Retry, error, attempt, and cache policy

Affected areas:

- `packages/core/src/errors.ts`
- `packages/core/src/node.ts`
- `packages/core/src/task.ts`
- `packages/scheduler/src/durable.ts`
- `packages/scheduler/src/execution-key.ts`
- `packages/agent/src/index.ts`

- [x] Add attempt and node-instance identity to `ExecutionContext`.
- [x] Propagate the actual scheduler attempt into `AgentTaskRequest`.
- [x] Define typed retryable, permanent, and unknown failure classification.
- [x] Preserve Agent response `retryable` instead of converting it to an untyped `Error`.
- [x] Enforce each task's `maxAttempts` and `backoffMs`.
- [ ] Add documented scheduler-level safety caps without replacing task policy silently.
- [x] Treat schema failures and missing implementations as permanent.
- [x] Compute execution keys after input validation and aggregation.
- [x] Include definition, version, input, artifacts, and executor identity in keys.
- [x] Persist execution keys on node instances.
- [ ] Represent cached `undefined` distinctly from no cached output.
- [x] Emit `node.cache_hit` and normal completion events on reuse.
- [ ] Require or derive cache-safe executor identity for agent tasks.

Tests:

- [ ] task with one maximum attempt does not retry;
- [ ] task-specific backoff is used;
- [ ] permanent Agent error does not retry;
- [ ] retryable Agent error receives incremented attempt;
- [ ] input/output schema errors are permanent;
- [x] cache hit skips execution;
- [ ] version/model/instructions/skills changes invalidate agent cache;
- [ ] `undefined` output can be cached.

## Milestone 4 - Explicit graph manifest version 2

Affected areas:

- `packages/core/src/node.ts`
- `packages/core/src/workflow.ts`
- `packages/scheduler/src/manifest.ts`
- `packages/scheduler/src/materialize.ts`
- `packages/scheduler/src/topology.test.ts`
- dashboard topology mapping

- [ ] Introduce an explicit internal graph representation during composition.
- [ ] Define edge input modes: `value`, `barrier`, `named`, and `collection`.
- [ ] Define an explicit terminal output selector.
- [ ] Stop deriving graph behavior from generated ID suffix regexes.
- [ ] Preserve stable generated IDs as identities only.
- [ ] Increment manifest schema version.
- [ ] Validate unique step IDs, endpoints, cycles, implementation presence, aggregation, and terminal output.
- [ ] Retain read/inspection support for manifest version 1.
- [ ] Decide and implement the accepted behavior for non-terminal version-1 runs.
- [ ] Update dashboard graph conversion for version 2 edges.

Tests:

- [ ] linear `then`;
- [ ] nested `tap` preserving the value edge;
- [ ] reused task at multiple call sites;
- [ ] nested and named fan-out;
- [ ] `Workflow.oneOf` and `Workflow.all`;
- [ ] `mapEach(...).then(...)`;
- [ ] invalid cycle and missing implementation rejection;
- [ ] local eager and durable output equivalence.

## Milestone 5 - Durable bounded dynamic work

Affected areas:

- `packages/core/src/node.ts`
- `packages/scheduler/src/dynamic.ts`
- `packages/scheduler/src/durable.ts`
- `packages/scheduler/src/materialize.ts`

- [ ] Define concurrency policy fields and defaults.
- [ ] Materialize `mapEach` item instances atomically with deterministic ordinal identity.
- [ ] Aggregate outputs by ordinal rather than insertion order.
- [ ] Complete empty collections without polling.
- [ ] Replace zero-delay parent retry polling with persisted aggregation dependencies/state.
- [ ] Implement `forEach` as durable subgraph instances or explicitly rename/document an in-memory-only alternative.
- [ ] Remove unbounded execution from durable collection operators.
- [ ] Apply at least runtime and dynamic-operator claim limits.
- [ ] Decide fan-out failure policy and represent it explicitly in the manifest.

Tests:

- [ ] empty, one-item, duplicate-item, and large collections;
- [ ] deterministic IDs and output ordering;
- [ ] partial item failure and retry;
- [ ] scheduler restart during expansion;
- [ ] bounded maximum in-flight executions;
- [ ] fail-fast or best-effort behavior matches explicit policy.

## Milestone 6 - Cloudflare runtime unification

Affected areas:

- `packages/cloudflare/src/durable-scheduler.ts`
- `apps/scheduler/src/index.ts`
- `apps/scheduler/wrangler.jsonc`
- Worker Vitest configuration and tests

Before implementation, retrieve current Durable Objects documentation for constructor initialization, SQLite transactions/storage gates, RPC, alarms, and test APIs using the repository's compatibility date.

- [ ] Implement the shared scheduler database/lifecycle contract over Durable Object SQLite.
- [ ] Use one Durable Object per run and deterministic `getByName(runId)` routing.
- [ ] Initialize schema safely in the object constructor lifecycle.
- [ ] Expose typed RPC methods where supported by the configured compatibility date.
- [ ] Execute bounded ticks and keep external I/O outside storage transactions.
- [ ] Set the one object alarm to the earliest retry/wake time.
- [ ] Reconstruct all state after object eviction.
- [ ] Use claim tokens to reject stale external responses.
- [ ] Replace the hard-coded `review-open-mrs` engine in `apps/scheduler` with workflow declarations and the shared runtime.
- [ ] Remove or deprecate the duplicate Cloudflare prototype after migration.
- [ ] Generate Worker binding types with Wrangler rather than maintaining drifting handwritten `Env` interfaces.
- [ ] Enable Worker logs and traces in deployment configuration.

Tests using `@cloudflare/vitest-pool-workers`:

- [ ] durable submission and status lookup;
- [ ] concurrent requests to one run;
- [ ] separate runs execute independently;
- [ ] alarm-driven retry;
- [ ] object restart/eviction reconstruction;
- [ ] stale claim response;
- [ ] duplicate keyed submission;
- [ ] parity fixtures with local SQLite.

## Milestone 7 - Agent boundary hardening

Affected areas:

- `packages/agent/src/index.ts`
- `packages/cloudflare/src/index.ts`
- `apps/agent/src/index.ts`
- Agent and scheduler Wrangler configuration

- [ ] Version the expanded Agent request contract.
- [x] Add node instance ID, execution token, attempt, and executor/deployment identity.
- [ ] Add runtime request and response schemas.
- [ ] Add configurable request and response size limits.
- [ ] Implement execution-token deduplication in the reference Agent runtime/helper.
- [ ] Prefer service bindings for internal calls.
- [ ] Define authenticated transport requirements for non-binding endpoints.
- [ ] Ensure credentials, full instructions, payloads, and outputs are excluded from default logs.
- [ ] Return typed permanent/retryable protocol failures.
- [ ] Document protocol-version compatibility and rollout.

Tests:

- [ ] malformed and oversized request rejection;
- [ ] unsupported protocol version;
- [ ] duplicate execution token;
- [ ] authentication failure for external transport;
- [ ] retryability propagation;
- [ ] no sensitive payloads in structured log fixtures.

## Milestone 8 - Documentation, cleanup, and release gate

- [ ] Update `README.md` architecture and hosted trigger examples.
- [ ] Update `docs/testing.md` to reflect implemented guarantees.
- [ ] Update RFD0001's implementation-status section or link to RFD0002.
- [ ] Document at-least-once attempts and application side-effect idempotency.
- [ ] Document manifest schema compatibility and migration behavior.
- [ ] Document local versus hosted scheduler APIs.
- [ ] Delete deprecated runtime paths after the compatibility window.
- [ ] Run the complete validation matrix on a clean checkout.
- [ ] Inspect package exports and generated declarations for accidental breaking changes.
- [ ] Record remaining out-of-scope work as issues or a follow-up RFD.

Release gate:

- [ ] all RFD acceptance criteria pass;
- [ ] local and Cloudflare conformance suites pass;
- [ ] no durable operator uses unbounded concurrency;
- [ ] no advertised guarantee is marked implemented without an executable test;
- [ ] examples deploy and execute through the shared runtime.

## Suggested pull-request sequence

1. Toolchain and honest documentation baseline.
2. Event sequences, claim tokens, and transactional local database operations.
3. Idempotent submission and asynchronous scheduler API.
4. Retry classification, actual attempts, and cache keys.
5. Explicit graph IR and manifest version 2.
6. Durable bounded dynamic instances.
7. Durable Object SQLite adapter and conformance suite.
8. Scheduler app migration and removal of duplicate engine.
9. Agent protocol hardening.
10. Documentation, compatibility cleanup, and release gate.

## Open questions and blockers

The following RFD decisions must be resolved before their dependent milestone is implemented:

- Fan-out failure policy blocks final manifest-v2 and dynamic aggregation semantics.
- Minimum custom Agent executor identity blocks cache-safe Agent reuse.
- Version-1 non-terminal run handling must be decided before the manifest-v2 migration ships.
- Initial local and Cloudflare claim limits must be selected before bounded dynamic execution is considered complete.

## Progress log

### 2026-09-22 — Milestone 0 baseline landed

- Completed the Bun toolchain alignment, CI workflow, public API baseline, local runtime conformance seam, and honest testing documentation.
- Moved top-level end-to-end tests from `e2e/` to `tests/e2e/`; test-only code remains outside publishable workspace packages.
- Changed `package.json`, `bun.lock`, `vitest.config.ts`, `README.md`, `docs/testing.md`, `.github/workflows/ci.yml`, and added `tests/e2e/workflow-conformance.ts` plus public-API/conformance tests.
- Discovered that `bun test` invokes Bun's built-in runner rather than the package script. Documentation now uses `bun run test`.
- Discovered that a clean parallel workspace typecheck could resolve dependencies before their declarations existed. Root builds now run in workspace dependency order; `typecheck` builds first, and CI runs `typecheck:packages` after its explicit build step.
- Validation passed: `bun install`, `bun run format:check`, `bun run typecheck`, `bun run test`, and `git diff --check`. The UI build emits its pre-existing `use client`/chunk-size warnings but succeeds.
- The user deferred Milestone 1 migrations. Next: start migration-independent Milestone 3 retry and attempt propagation work.

### 2026-09-22 — Milestone 3 retry-policy slice landed

- Deferred Milestone 1 migration work at the user's request; it remains a prerequisite for storage-backed submission/idempotency in Milestone 2.
- Added `nodeInstanceId` and one-based `attempt` to `ExecutionContext`; `DurableTaskScheduler` supplies persisted values for every durable task execution.
- `Task.agent` now accepts task retry metadata and forwards the actual durable attempt instead of always sending attempt `1`.
- Durable retries now use the task definition's `maxAttempts` and static `backoffMs`. The existing scheduler retry option acts only as a cap and cannot silently replace task policy.
- Added tests for a task that must not exceed one attempt and for Agent request attempt/retry propagation.
- Validation passed: `bun run build`, `bun run typecheck:packages`, and `bun run test:unit`.
- Next: complete typed failure classification and preserve Agent `retryable` responses without moving the deferred storage migration work.

### 2026-09-22 — Milestone 3 failure-classification slice landed

- Added core `ExecutionFailure`, `RetryableExecutionError`, `PermanentExecutionError`, and `retryabilityOf`; serialized errors retain explicit retryability through wrapper cause chains.
- Added `AgentTaskError`, so `createAgentEndpoint` converts an AgentRuntime `{ ok: false }` response into a typed retryable or permanent error rather than an untyped `Error`.
- Durable execution classifies schema-decoding failures as permanent, preventing retries of invalid persisted input or invalid task output. Explicit permanent errors also stop retrying; unclassified errors retain at-least-once retry behavior while attempts remain.
- Added scheduler and Cloudflare endpoint tests for invalid-output and permanent AgentRuntime paths.
- Validation passed: `bun run build` and `bun run test:unit`.
- Next: compute and persist cache execution keys after validated input aggregation. This remains migration-independent in code, but cache persistence semantics may need revisiting with the deferred transactional storage work.

### 2026-09-22 — Merge resolution and basic cache-reuse slice landed

- Resolved the `README.md` rebase conflict by retaining the new manual-first introduction and restoring Bun repository checks plus deploy commands. The manual remains the primary user-facing documentation.
- Cacheable durable tasks now compute an execution key only after input validation, persist it on the claimed node instance, and reuse an earlier completed node with the same key. The key currently includes workflow definition, task definition/version, validated input, and artifact digests.
- Added a durable scheduler test proving a second identical cacheable task completes without executing its function.
- Executor identity, Agent cache safety, cached `undefined` output, cache-hit events, and transactional cache races remain incomplete and are deliberately unchecked in this plan.
- Validation passed: `bun run build` and `bun run test:unit`.
- Next: add explicit executor identity to cache keys, beginning with `Task.agent` model/instructions/skills, without claiming cross-endpoint cache safety yet.

### 2026-09-22 — Cache executor-identity slice landed

- Added optional stable executor identity to source task definitions and cache keys. `Task.agent` automatically includes protocol version, endpoint identity, instructions, model, and sorted skills; callers may provide application-owned identity for model tooling or tenant scope.
- `createAgentEndpoint` now supplies a stable service-binding/path identity by default and accepts a caller override for a concrete deployment identity.
- Added execution-key coverage for differing executor identity.
- This is an identity mechanism, not an assertion that every Agent endpoint is safely cacheable: callers must supply application/tenant/deployment identity where the default binding/path value is insufficient.
- Validation passed: `bun run build` and `bun run test:unit`.
- Next: represent cached `undefined` explicitly; cache-hit lifecycle events can proceed without the deferred event-sequencing migration.

### 2026-09-22 — Cache-hit observability slice landed

- Added `node.cache_hit` to the scheduler event contract. A reuse now persists that event before the cached node is marked completed, then emits the normal `node.completed` event.
- Added unit coverage for the full first-execution/cache-hit lifecycle event order.
- Cached `undefined` remains intentionally unresolved because current node persistence represents absent output and `undefined` output identically.
- Next: defer that representation change until the storage migration work resumes, then make cache persistence and reuse transactional.

### 2026-09-22 — Agent execution-identity slice landed

- Removed the GitHub Pages workflow at the user's request; the manual remains repository Markdown only.
- Expanded Agent task requests with persisted node-instance identity, a stable attempt execution token, and executor identity. `Task.agent` derives all fields from durable execution context; the sample Scheduler and Agent applications now send and validate them.
- Updated Cloudflare deployment guidance to explain endpoint deduplication use of the execution token.
- Validation passed: `bun run build`, `bun run test:unit`, and `bun run test:workers`.
- The user reprioritized execution: next is Milestone 2, beginning with the minimal idempotency storage migration; then durable bounded fan-out and Cloudflare runtime unification. Agent schemas/limits resume afterward.
