# Team deployment

This is the intended shape for a team-owned libclank deployment. The scheduler and Agent SDK runtime are deployed from the same repository, but are separate Cloudflare applications.

```text
examples/team-deployment/
  scheduler Worker → team AgentRuntime DO
```

## Scheduler

```ts
const agent = createAgentEndpoint(env.REVIEW_AGENT)

const review = Task.agent<MergeRequest, Review>({
  id: Id.node("review-merge-request"),
  endpoint: agent,
  instructions: "Use the configured GitLab MCP tools to review this MR.",
})

const workflow = Triggers.manual({
  id: Id.trigger("review-open-mrs"),
}).then(discoverOpenMrs).forEach((mr) => mr.then(review))

export default createTriggerApp(createScheduler({
  workflows: [workflow],
  observer: SchedulerObservers.noop,
}))
```

## Agent runtime

```ts
export class ReviewAgent extends Agent<Env> {
  override initialState = {}

  // The team owns this implementation: model, MCP servers, tools,
  // skills, permissions, and output validation.
}
```

The scheduler only knows the `AgentEndpoint` protocol. The team owns the AgentRuntime DO lifecycle, bindings, secrets, migrations, and deployment.

Deploy independently:

```bash
pnpm --filter @libclank/app-agent exec wrangler deploy
pnpm --filter @libclank/app-scheduler exec wrangler deploy
```
