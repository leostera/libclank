# Cloudflare and deployment

LibClank separates workflow scheduling from agent execution. On Cloudflare, a common deployment has two applications:

```text
scheduler Worker / workflow-run Durable Object
  → service binding
team-owned Agent Worker / Durable Object
```

The team owns agent models, credentials, tools, MCP servers, skills, and policy. LibClank owns the typed request/response seam.

## Connect to an agent service binding

In the scheduler Worker:

```ts
import { Task } from "@libclank/agent"
import { createAgentEndpoint } from "@libclank/cloudflare"
import { Id } from "@libclank/core"

interface Env {
  REVIEW_AGENT: Fetcher
}

function makeReviewTask(env: Env) {
  const endpoint = createAgentEndpoint(env.REVIEW_AGENT)

  return Task.agent<MergeRequest, Review>({
    id: Id.node("review-merge-request"),
    endpoint,
    instructions: "Review this merge request using the team's configured tools.",
  })
}
```

`createAgentEndpoint` sends a versioned `AgentTaskRequest` to `/task` by default.

Configure the binding in `wrangler.jsonc`:

```jsonc
{
  "services": [
    {
      "binding": "REVIEW_AGENT",
      "service": "my-review-agent",
    },
  ],
}
```

## Implement the agent endpoint

The agent service must accept the protocol and return an `AgentTaskResponse`:

```ts
import type { AgentTaskRequest, AgentTaskResponse } from "@libclank/agent"

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/task") {
      return new Response("Not found", { status: 404 })
    }

    const task = (await request.json()) as AgentTaskRequest<unknown>

    try {
      const output = await executeWithTeamAgent(task)
      return Response.json({
        ok: true,
        output,
      } satisfies AgentTaskResponse)
    } catch (error) {
      return Response.json({
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          retryable: isRetryable(error),
        },
      } satisfies AgentTaskResponse)
    }
  },
}
```

At a real trust boundary, decode the request and output rather than relying on the cast shown for brevity.

## Use an Agents SDK Durable Object

A team can route `/task` to its own Agents SDK class:

```ts
export class ReviewAgent extends Agent<Env> {
  override initialState = {}

  override async fetch(request: Request): Promise<Response> {
    // Validate the AgentTaskRequest, invoke configured tools/model,
    // validate output, and return AgentTaskResponse.
  }
}
```

The agent's state and deployment are independent from workflow-run state.

## Trigger routes in a Worker

`createTriggerApp` returns a Hono application and works in a Worker:

```ts
const scheduler = createScheduler({
  workflows: [workflow],
  observer: SchedulerObservers.noop,
})

const app = createTriggerApp(scheduler)
export default app
```

This form uses the eager scheduler and does not make execution durable merely because it runs on Workers.

## Durable Object coordination

`@libclank/cloudflare` exports `CloudflareWorkflowRun`, a lower-level SQLite-backed coordinator that can:

- store ready/running/completed/failed task state;
- execute through a supplied task executor;
- retry with alarms;
- persist node events.

Use one Durable Object instance per workflow run. The deployable `apps/scheduler` example demonstrates the intended request routing and one-run-per-object model.

The complete code-first manifest scheduler is currently most mature on local SQLite. Cloudflare primitives and emulator tests exist, but applications should treat the hosted orchestration layer as an integration surface under active development rather than assume feature parity with `createDurableScheduler`.

## Idempotent run routing

A useful Worker convention is to accept an idempotency key and derive the Durable Object identity from it:

```text
POST /run/my-workflow
Idempotency-Key: <UUID>
```

Repeated requests with the same key reach the same run object. Validate the key and return the existing run rather than starting duplicate work.

## Wrangler configuration

Scheduler:

```jsonc
{
  "name": "my-scheduler",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "services": [{ "binding": "AGENT", "service": "my-agent" }],
  "durable_objects": {
    "bindings": [{ "name": "WORKFLOW_RUN", "class_name": "WorkflowRun" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["WorkflowRun"] }],
}
```

Agent:

```jsonc
{
  "name": "my-agent",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "durable_objects": {
    "bindings": [{ "name": "AGENT", "class_name": "ReviewAgent" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ReviewAgent"] }],
}
```

Deploy the agent first, then the scheduler that binds to it:

```bash
bunx wrangler deploy --config apps/agent/wrangler.jsonc
bunx wrangler deploy --config apps/scheduler/wrangler.jsonc
```

## Deployment checklist

- Keep task and trigger IDs stable.
- Deploy compatible source implementations for persisted step IDs.
- Validate every wire payload with a schema.
- Store credentials only in the owning service.
- Use idempotency keys for starts and external side effects.
- Set explicit task and fetch timeouts.
- Decide how retryable agent errors map to scheduler retries.
- Protect run and event endpoints with authentication.
- Test with the Workers emulator before deploying.
- Confirm whether your chosen Cloudflare path supports every local feature your workflow uses.
