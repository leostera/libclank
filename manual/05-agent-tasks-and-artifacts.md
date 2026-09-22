# Agent tasks and artifacts

LibClank treats an agent as a task implementation behind an `AgentEndpoint`. The scheduler does not own model credentials, tools, MCP servers, or agent lifecycle.

## `Task.agent`

```ts
import { Task } from "@libclank/agent"
import { Id } from "@libclank/core"

const review = Task.agent<MergeRequest, Review>({
  id: Id.task("review-merge-request"),
  endpoint: reviewAgent,
  instructions: "Review the merge request and return a structured review.",
  model: "preferred-model",
  skills: ["gitlab-review"],
})
```

Agent tasks:

- require a workflow run ID;
- send a versioned `AgentTaskRequest`;
- include node ID, input, instructions, model, and skills;
- default to `cache: "by-input"` because agent work is often expensive;
- resolve through the same durable step registry as ordinary tasks.

Only enable input caching when outputs are immutable and safe to reuse.

## Agent endpoint protocol

The scheduler-facing contract is intentionally small:

```ts
interface AgentEndpoint {
  run<Input, Output>(request: AgentTaskRequest<Input>): Effect.Effect<Output, unknown, never>
}
```

A team-owned runtime can implement model selection, prompts, MCP tools, permissions, and output validation independently.

For Cloudflare service bindings:

```ts
import { createAgentEndpoint } from "@libclank/cloudflare"

const endpoint = createAgentEndpoint(env.REVIEW_AGENT)
```

The target receives a JSON request at `/task` by default and returns the versioned agent response shape.

## Local Pi endpoint

`createPiEndpoint` adapts Pi's non-interactive CLI:

```ts
import { createPiEndpoint, fileOutput } from "@libclank/local"

const endpoint = createPiEndpoint<Input, Output>({
  prompt: ({ input }) => `
Read ${input.url} and write Markdown exactly to ${input.path}.
Use tools to verify the exact path before finishing.
`,
  output: fileOutput,
})
```

It invokes:

```text
pi --print --no-session --approve <prompt>
```

The `output` callback runs after Pi exits. It must verify and decode the side effect rather than trusting prose printed by the model.

## File outputs

Use `fileOutput` when the expected output has a `path`:

```ts
const endpoint = createPiEndpoint<Request, Request>({
  prompt,
  output: fileOutput,
})
```

It fails if the exact path does not exist. Always create the path before task execution and include it explicitly in the task input.

Good:

```ts
return {
  url: body.url,
  path: join(outputDirectory, `${crypto.randomUUID()}.md`),
}
```

Bad:

```ts
// The agent has to guess where output belongs.
return { url: body.url }
```

## Structured JSON outputs

### Custom decoder

```ts
const endpoint = createPiEndpoint<Request, Summary>({
  prompt,
  output: jsonFileOutput((value) => parseSummary(value)),
})
```

### Effect Schema decoder

```ts
const Summary = Schema.Struct({
  title: Schema.String,
  summary: Schema.String,
  sources: Schema.Array(Schema.String),
})

const endpoint = createPiEndpoint<Request, Schema.Schema.Type<typeof Summary>>({
  prompt,
  output: jsonSchemaFileOutput(Summary),
})
```

Agent-generated JSON is untrusted external data. Decode it before returning it as a task output.

## Content-addressed artifacts

The `@libclank/artifacts` contract represents immutable content:

```ts
interface ArtifactRef {
  id: ArtifactId
  digest: `sha256:${string}`
  name: string
  contentType: string
  size: number
}
```

Create a local store:

```ts
import { createLocalArtifacts } from "@libclank/local"

const artifacts = createLocalArtifacts()

const ref = await artifacts.put({
  name: "report.md",
  contentType: "text/markdown",
  body: "# Report\n",
})

const bytes = await artifacts.get(ref)
const exists = await artifacts.has(ref.digest)
```

Default storage layout:

```text
.clank/artifacts/sha256/<first-two-hex>/<remaining-hex>
```

Putting the same bytes again produces the same digest and does not require duplicate content.

## Plain files versus artifact references

Current examples often pass a plain path:

```ts
{
  path: "/absolute/path/to/report.md"
}
```

That is useful for local tools and OS integration, but it is not portable across machines. Durable workflows intended for multiple runtimes should prefer `ArtifactRef` and use a runtime-specific artifact store.

Use plain paths when:

- the workflow is explicitly local;
- an external CLI requires filesystem access;
- the file is a user-facing convenience.

Use content-addressed references when:

- output must survive relocation;
- deduplication matters;
- provenance matters;
- another runtime will consume the output.

## Opening local files

```ts
import { openFile } from "@libclank/local"

const openReport = openFile({
  id: Id.task("open-report"),
  required: false,
})
```

Set `required: false` for convenience-only UI effects. Failure to launch an OS viewer then does not fail the workflow. Leave it required when opening the file is genuinely part of the workflow contract.

## Side-effect safety

External tasks can be executed more than once after a crash or lease expiration. Design them around an idempotency key such as:

```text
run ID + step ID + attempt-independent operation key
```

Recommended patterns:

- write immutable files to deterministic paths;
- use atomic rename after successful generation;
- check whether content already exists;
- pass idempotency keys to remote APIs;
- separate content generation from convenience effects such as opening a file;
- persist an artifact before notifying an external system.
