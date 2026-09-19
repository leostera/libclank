# libclank

Cloudflare-native, typed agentic workflows. A single pnpm monorepo for workflow graphs, a Cloudflare scheduler runtime, and team-owned Agents SDK runtimes.

## Repository

```text
packages/core        graph primitives, opaque IDs, triggers
packages/scheduler   execution events and event stores
packages/agent       Task.agent and AgentEndpoint protocol
packages/cloudflare  Hono + Workers endpoint adapters
packages/gitlab      optional typed GitLab tasks
apps/scheduler       deployable workflow Worker
apps/agent           deployable team-owned Agents SDK DO
```

## Deployment model

```text
scheduler Worker
  → workflow-run coordination
  → Task.fn / Task.effect
  → Task.agent → team-owned Agent SDK DO
```

The scheduler does not use Cloudflare's external `cloudflare-agent` product. Teams deploy their own `AgentRuntime` in `apps/agent`; the scheduler uses an `AgentEndpoint` to reach it. Agent lifecycle, credentials, tools, and deployment remain team-owned.

## Checks

```bash
pnpm install
pnpm build
pnpm typecheck
```

Deploy the applications independently with Wrangler:

```bash
pnpm --filter @libclank/app-agent exec wrangler deploy
pnpm --filter @libclank/app-scheduler exec wrangler deploy
```

The Agent SDK task protocol and Durable Object-backed workflow execution are the next implementation layer. The current repository establishes the Cloudflare-only package boundaries and typed endpoint seam.
