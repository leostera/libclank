# LibClank

Typed, code-first agentic workflows with durable local execution and an operational dashboard.

Define workflows in TypeScript with Effect. LibClank persists runs, task instances, dependencies, attempts, outputs, artifacts, leases, and events—not JavaScript closures.

```text
webhook
  → fetch source
    → analyze topic
    → analyze style
    → analyze confidence
```

## User manual

Start with the [LibClank Manual](manual/README.md):

- [Getting started](manual/01-getting-started.md)
- [Authoring workflows](manual/03-authoring-workflows.md)
- [Local durable runtime](manual/04-local-durable-runtime.md)
- [Agent tasks and artifacts](manual/05-agent-tasks-and-artifacts.md)
- [Dashboard and operations](manual/06-dashboard-and-operations.md)
- [Testing your workflows](manual/07-testing.md)
- [Cloudflare and deployment](manual/08-cloudflare-and-deployment.md)
- [Reference and limitations](manual/10-reference-and-limitations.md)

## Try an example

LibClank uses Bun 1.3.11 (declared in `package.json` and locked by `bun.lock`).

```bash
bun install --frozen-lockfile
bun run example:parallel-analyses
```

Then open <http://localhost:8789/>.

The parallel-analysis example uses local SQLite, Pi-backed agent tasks, a run graph, and persisted logs. It requires Pi to be installed and authenticated.

## Repository checks

```bash
bun run format:check
bun run typecheck
bun run build
bun run test
```

## Deploy the example applications

```bash
bun run --filter @libclank/app-agent exec wrangler deploy
bun run --filter @libclank/app-scheduler exec wrangler deploy
```

## Contributor documentation

Architecture, implementation rationale, and roadmap material live in [`docs/rfds/`](docs/rfds/), beginning with [RFD0001](docs/rfds/RFD0001-libclank-design.md).
