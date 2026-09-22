# RFD0003 - Typed Definition and Runtime Identities

- Feature Name: `typed-definition-and-runtime-identities`
- Start Date: `2026-09-22`
- Status: Proposed

## Summary

LibClank will separate named source definitions from runtime workflow graph nodes. Tasks, triggers, workflows, agents, and artifacts will have stable named identifiers such as `clank:task:ping-on-gchat` and `clank:trigger:gitlab-mr-opened`. Composed graph nodes will instead receive UUID-backed identities such as `clank:node:<uuid>`, and persisted runtime records will use distinct identifiers such as `clank:run:<uuid>` and `clank:event:<uuid>`. Composition operators such as `then`, `tap`, and `map` will describe graph edges and transformations; they will not leak implementation names into public node IDs.

## Motivation

The current identifier model uses values such as:

```text
clank:node:<composition-generated-identifier>
```

This value is difficult to interpret because it combines several concepts:

- `node` is being used for both source definitions and graph positions;
- `gitlab-mr-opened` is a trigger name, not necessarily a task identity;
- `then` is an implementation detail of the fluent composition API;
- the identifier does not reveal whether it names reusable code, a graph node, or a persisted runtime instance.

This ambiguity affects authors, operators, dashboard readers, and runtime implementers.

Concrete problems include:

1. A dashboard operator sees `.../then` and cannot tell what task will execute.
2. The same task used twice in one workflow needs two distinct graph nodes, but the current ID model encourages treating task and node identity as the same thing.
3. A persisted node instance needs a runtime identity that is different from the source task it executes.
4. Event and run IDs should be visibly distinguishable from source definitions.
5. Manifest, cache, retry, and registry code currently has to infer which kind of identity a field contains.

The proposed model makes the distinction explicit and gives every identifier a consistent, readable `clank:` URI form.

## Goals and non-goals

### Goals

- Give each conceptual identity one unambiguous type and URI kind.
- Make task and trigger identifiers stable, named, and source-controlled.
- Give composed graph nodes UUID-backed identities independent of composition syntax.
- Give runs and events distinct UUID-backed runtime identities.
- Preserve readable names for dashboards, logs, manifests, and debugging.
- Support multiple uses of one task within one workflow.
- Make the identity contract usable by local SQLite and Cloudflare Durable Object runtimes.
- Provide an additive migration path from current branded string IDs.

### Non-goals

- Making every runtime UUID human memorable.
- Encoding workflow topology into a node UUID.
- Defining the complete manifest-v2 graph format; this RFD defines identity inputs to that manifest.
- Providing globally unique task names across unrelated deployments.
- Changing task execution, retry, cache, or event semantics beyond their identity references.

## Guide-level explanation

### Named definitions

Source-authored reusable definitions receive named IDs:

```ts
Id.task("ping-on-gchat")
// clank:task:ping-on-gchat

Id.trigger("gitlab-mr-opened")
// clank:trigger:gitlab-mr-opened

Id.workflow("auto-review")
// clank:workflow:auto-review
```

These IDs are stable across runs and are suitable for source code, manifests, deployment metadata, and operator-facing labels.

### Graph nodes

A workflow graph contains node positions. A node is not the task implementation; it is a particular placement of a task in one compiled workflow graph:

```text
clank:node:4c0b...
  taskId: clank:task:ping-on-gchat
```

If the same task is used twice, each call site receives a different node ID:

```text
clank:task:send-gchat

clank:node:8d21... → taskId: clank:task:send-gchat
clank:node:af34... → taskId: clank:task:send-gchat
```

The dashboard can show the useful information together:

```text
Send Google Chat notification
Task  clank:task:send-gchat
Node  clank:node:8d21...
```

### Composition is graph structure

This source expression:

```ts
gitlabMergeRequestOpened.then(pingOnGchat)
```

compiles to two graph nodes and an edge:

```text
clank:node:91a...  taskId: clank:trigger:gitlab-mr-opened
        │
        │ value
        ▼
clank:node:8d21... taskId: clank:task:ping-on-gchat
```

The word `then` does not become an identity. It is represented by the edge's input mode and dependency relationship.

### Runtime identities

Persisted execution records use separate UUID-backed identities:

```text
clank:run:018f6b8e-...
clank:event:018f6b8e-...
clank:node-instance:018f6b8e-...
```

A runtime node instance references its compiled graph node and task:

```text
{
  "id": "clank:node-instance:...",
  "nodeId": "clank:node:8d21...",
  "taskId": "clank:task:ping-on-gchat",
  "runId": "clank:run:..."
}
```

This makes retries and recovery addressable without pretending that a task definition is itself an execution.

## Reference-level explanation

### URI grammar

LibClank IDs use an opaque URI scheme:

```text
clank:<kind>:<identifier>
```

The initial kinds are:

```text
task
trigger
workflow
agent
artifact
node
node-instance
run
event
execution
```

Examples:

```text
clank:task:fetch-markdown
clank:trigger:gitlab-mr-opened
clank:workflow:auto-review
clank:agent:leobot
clank:artifact:merge-request-payload
clank:node:550e8400-e29b-41d4-a716-446655440000
clank:node-instance:550e8400-e29b-41d4-a716-446655440000
clank:run:550e8400-e29b-41d4-a716-446655440000
clank:event:550e8400-e29b-41d4-a716-446655440000
```

Named definition identifiers may contain a normalized path-like name after the kind. Runtime identifiers use UUIDs. Names are encoded so reserved separators cannot change the parsed kind or identifier.

The parser must reject:

- unknown kinds;
- missing kinds or identifiers;
- additional URI query/hash components;
- relative path segments in named identifiers;
- malformed UUIDs for UUID-backed kinds.

### Type model

The core ID types will become distinct branded types:

```ts
type TaskId = Opaque<string, "TaskId">
type TriggerId = Opaque<string, "TriggerId">
type WorkflowId = Opaque<string, "WorkflowId">
type AgentId = Opaque<string, "AgentId">
type ArtifactId = Opaque<string, "ArtifactId">
type NodeId = Opaque<string, "NodeId">
type NodeInstanceId = Opaque<string, "NodeInstanceId">
type RunId = Opaque<string, "RunId">
type EventId = Opaque<string, "EventId">
```

Constructors make the distinction visible:

```ts
Id.task("send-gchat")
Id.trigger("gitlab-mr-opened")
Id.node() // UUID-backed
Id.nodeInstance() // UUID-backed
Id.run() // UUID-backed
Id.event() // UUID-backed
```

A node constructor may accept a UUID for deserialization, but it must not derive a node ID from a parent name or composition operator.

### Task and node contracts

A task definition contains reusable implementation metadata:

```ts
interface TaskDefinition {
  readonly id: TaskId
  readonly version: string
  readonly description: string
  readonly retry: RetryPolicy
  readonly cache: CachePolicy
}
```

A compiled graph node contains placement and topology metadata:

```ts
interface GraphNode {
  readonly id: NodeId
  readonly taskId: TaskId | TriggerId
  readonly workflowId: WorkflowId
  readonly dependencies: readonly NodeId[]
}
```

A node instance contains runtime state:

```ts
interface NodeInstanceRecord {
  readonly id: NodeInstanceId
  readonly runId: RunId
  readonly nodeId: NodeId
  readonly taskId: TaskId | TriggerId
  readonly attempt: number
  readonly status: NodeInstanceStatus
}
```

The scheduler resolves executable code through `taskId`; it uses `nodeId` to interpret graph topology and `nodeInstanceId` to persist one execution within one run.

### Trigger identity

Triggers remain named definitions:

```ts
const trigger = Triggers.webhook({
  id: Id.trigger("gitlab-mr-opened"),
  path: "/hooks/gitlab/merge-request-opened",
})
```

A trigger may have a corresponding graph node in the compiled workflow, but the trigger definition and graph node must not share a type or be confused in storage.

### Composition

Composition methods continue to be ergonomic:

```ts
const workflow = gitlabMergeRequestOpened.then(pingOnGchat)
```

Internally, composition creates graph nodes with UUID identities and records explicit edges. It may assign source metadata or display labels for debugging, but those labels are not identity. Operators such as `then`, `tap`, `map`, and `fanout` are encoded as edge/input metadata or graph annotations.

Anonymous inline transformations require an explicit policy. A transformation that must be independently retried, cached, inspected, or resumed must be promoted to a named task. A purely structural transformation may remain part of its containing node and must not create a fake public task identity.

### Cache, retries, and events

Caches and retry records reference task and node identities separately:

```text
cache key inputs:
  workflow definition hash
  task ID and version
  graph node ID when graph placement affects semantics
  validated input
  executor identity
```

Events reference runtime records:

```text
runId:          clank:run:...
nodeId:         clank:node:...
nodeInstanceId: clank:node-instance:...
eventId:        clank:event:...
taskId:         clank:task:...
```

This makes event payloads readable without using runtime UUIDs as task definitions or task names as execution identities.

### Compatibility and migration

All persisted identifiers use `clank:<kind>:<identifier>`. There is no compatibility parser or legacy identifier mode. Deployments must migrate or discard old manifests before enabling this model; historical data is not reinterpreted as a new task or node identity.

### Testing and acceptance criteria

Implementation is complete when:

- each ID kind has a distinct TypeScript brand and parser validation;
- constructors emit `clank:<kind>:<identifier>` values;
- task IDs are named and stable;
- graph node IDs are UUID-backed;
- node instances, runs, and events are UUID-backed and distinct;
- a task used twice produces two graph nodes pointing to one task ID;
- composition operators do not appear as node identity suffixes;
- manifests store task references and graph node references separately;
- local SQLite and Cloudflare runtime records use the split model;
- persisted manifests and runtime records use only the new identifier model;
- dashboard output shows task identity and node identity separately.

## Drawbacks

- The split model adds more fields and concepts to manifests and database records.
- UUID graph IDs are less immediately readable than names in logs.
- Existing code that treats `Node.id` as a task registry key needs migration.
- Legacy ID compatibility creates temporary parser and display complexity.
- Anonymous inline transformations need clearer authoring rules.
- Cache keys may become more precise and therefore less reusable across graph placements.

## Rationale and alternatives

### Keep generated composition-path node IDs

This requires the fewest changes, but it preserves the ambiguity between task, graph node, and runtime instance. It also makes composition syntax part of the persistence contract. It is rejected.

### Use names for graph nodes

Names are readable, but they collide when a task is reused, when branches contain similar work, or when one workflow is compiled more than once. UUID-backed node IDs provide unambiguous graph identity while task IDs preserve readability.

### Give every composed node a generated semantic path

This is the current direction in a more elaborate form: `workflow/then/tap/map`. It remains coupled to source composition shape and makes refactors look like identity changes. It is rejected in favor of explicit graph identity plus edge metadata.

### Use only UUIDs for everything

This would simplify uniqueness but remove useful source-level references for tasks, triggers, workflows, and agents. Named definitions are valuable for authoring, cache policy, dashboards, and deployment diagnostics.

### Do nothing

The current model can continue to execute small workflows, but operators and runtime code will keep confusing source definitions with graph positions and persisted executions. Future durable graph work will become harder to migrate.

## Prior art

DAG schedulers distinguish logical task definitions from task instances created for a particular run. Build systems distinguish source actions from execution records and cache entries. Database schemas commonly use stable natural identifiers for definitions and opaque IDs for events and transactions. Cloudflare Durable Objects also distinguish a class/binding identity from an individual object identity.

LibClank should adopt the distinction without importing the operational complexity of those systems: named definitions for source intent, UUID-backed nodes and runtime records for compiled and executed state.

## Unresolved questions

- Should `clank:execution:<uuid>` be introduced now, or can `node-instance` plus attempt identify execution sufficiently?
- Should legacy IDs be preserved byte-for-byte in historical API responses or wrapped in an explicit legacy representation?
- What display label should be used for anonymous structural transformations?
- Should workflow IDs be required explicitly, or may LibClank continue deriving them from the root definition during a compatibility period?

## Future possibilities

- A manifest compiler can provide stable call-site source locations without exposing them as identifiers.
- Dashboard URLs can use `clank:run:` and `clank:node-instance:` values directly.
- Trace attributes can carry task, node, node-instance, run, and event IDs independently.
- A workflow diff tool can distinguish task changes from graph-placement changes.
- Cross-deployment compatibility checks can compare task versions independently of graph UUIDs.
