# LibClank Manual

This directory is the user manual: installing LibClank, authoring workflows, running them, and operating applications. Contributor architecture, implementation rationale, and internal roadmap material intentionally live in [`docs/rfds/`](../docs/rfds/).

LibClank is a typed, code-first library for building agentic workflows and running them as inspectable execution graphs. Workflow definitions stay in TypeScript. Durable runtimes persist identifiers, inputs, outputs, dependencies, attempts, artifacts, leases, and events—not JavaScript closures.

> **Project status:** LibClank is under active development. The local durable runtime, operational API, dashboard, manifests, static fan-out, schema boundaries, and initial dynamic fan-out machinery are implemented. Lifecycle controls, automatic background resumption, event streaming, and some dynamic graph behavior are still evolving. See [Current limitations](10-reference-and-limitations.md#current-limitations).

## Start here

1. [Getting started](01-getting-started.md) — run an example and build a small durable workflow.
2. [Mental model](02-mental-model.md) — nodes, tasks, step IDs, manifests, runs, and events.
3. [Authoring workflows](03-authoring-workflows.md) — triggers and composition operators.
4. [Local durable runtime](04-local-durable-runtime.md) — SQLite, Hono, and process setup.
5. [Agent tasks and artifacts](05-agent-tasks-and-artifacts.md) — Pi, remote agents, files, and content-addressed artifacts.
6. [Dashboard and operations](06-dashboard-and-operations.md) — mount and use the operational console.
7. [Testing your workflows](07-testing.md) — task tests, durable application tests, and agent doubles.
8. [Cloudflare and deployment](08-cloudflare-and-deployment.md) — runtime boundaries and team-owned agents.
9. [Troubleshooting](09-troubleshooting.md) — common failures and local cleanup.
10. [Reference and limitations](10-reference-and-limitations.md) — package/API map and implementation status.

## Choose a runtime

LibClank currently exposes two scheduler styles:

| Runtime                    | API                                                       | Use it for                                                                                                     |
| -------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Eager, in-memory           | `createScheduler` from `@libclank/core`                   | Small examples, composition experiments, and execution where process durability is unnecessary                 |
| Durable, local             | `createDurableScheduler` + `createLocalSchedulerDatabase` | Runs that need persisted topology, node state, outputs, events, and an operational dashboard                   |
| Cloudflare building blocks | `@libclank/cloudflare` and the scheduler Worker           | Worker/DO integration and team-owned agent deployments; the complete hosted lifecycle is still being developed |

For new local applications, start with the durable runtime.

## Design principles

- **Code is the authoring interface.** There is no visual workflow editor.
- **The database is authoritative.** Durable execution does not depend on a surviving call stack.
- **Functions are not serialized.** Persisted step IDs resolve against implementations loaded from deployed source.
- **Call sites have identity.** A reusable task ID and a workflow step ID are related but distinct.
- **External data is decoded.** Use Effect Schema at HTTP, task, persisted JSON, and agent-output boundaries.
- **Artifacts are explicit.** Pass immutable artifact references or deliberate file paths; do not hide filesystem side effects.
- **The dashboard is operational.** It starts registered workflows and inspects runs; it does not create workflow definitions.

## Repository examples

| Example           | Command                             | Demonstrates                                              |
| ----------------- | ----------------------------------- | --------------------------------------------------------- |
| URL summary       | `bun run example:url-summary`       | Webhook → local Pi agent → Markdown file → OS open        |
| Link digest       | `bun run example:link-digest`       | Structured agent output, collection mapping, synthesis    |
| Parallel analyses | `bun run example:parallel-analyses` | Durable SQLite scheduler, static fan-out, dashboard, logs |

The parallel-analysis example is the best end-to-end starting point.

## Contributor documentation

This manual intentionally does not explain how to develop LibClank itself. Contributors should start with [`docs/rfds/`](../docs/rfds/), especially [RFD0001 — LibClank Durable Workflow Runtime](../docs/rfds/RFD0001-libclank-design.md).
