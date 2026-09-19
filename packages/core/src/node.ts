import { Cause, Effect } from "effect"
import { findNodeExecutionError, NodeExecutionError } from "./errors.js"
import { Id, type NodeId, type TriggerId } from "./id.js"
import { notify, type SchedulerObserver } from "./observer.js"

export interface ExecutionContext {
  readonly triggerValues: ReadonlyMap<TriggerId, unknown>
  readonly runId?: import("./id.js").RunId
  readonly nodeId?: NodeId
  readonly observer?: SchedulerObserver
}

export type NodeRun<Output> = Effect.Effect<Output, unknown, never>
export type NodeFunction<Input, Output> = (input: Input, context?: ExecutionContext) => NodeRun<Output>

/** Source-defined metadata persisted by durable schedulers; executable closures are never persisted. */
export interface NodeDefinition {
  readonly id: NodeId
  readonly description: string
  readonly version: string
  readonly cache: "never" | "by-input"
}

export interface TriggerDefinition<Output = unknown> {
  readonly id: TriggerId
  readonly kind: "webhook" | "cron" | "manual"
  readonly path?: string
  readonly schedule?: string
  readonly decode?: (request: Request) => Output | Promise<Output>
}

export class Node<Input, Output> {
  /** A function property intentionally makes Input contravariant and Output covariant. */
  readonly execute: (input: Input, context?: ExecutionContext) => NodeRun<Output>

  constructor(
    readonly id: NodeId,
    run: NodeFunction<Input, Output>,
    readonly triggers: readonly TriggerDefinition[] = [],
    readonly observable = true,
    readonly definition: NodeDefinition = { id, description: Id.name(id), version: "1", cache: "never" },
  ) {
    this.execute = (input, context) => {
      const observer = context?.observer
      const execution = Effect.catchCause(run(input, context), (cause) => {
        const error = Cause.squash(cause)
        return Effect.fail(findNodeExecutionError(error) ?? new NodeExecutionError(this.id, error))
      })
      if (!observer || !this.observable) return execution
      const startedAt = Date.now()
      return Effect.tapError(
        Effect.tap(
          Effect.andThen(
            Effect.sync(() =>
              notify(() =>
                observer.nodeStarted({
                  nodeId: this.id,
                  ...(context?.runId === undefined ? {} : { runId: context.runId }),
                }),
              ),
            ),
            execution,
          ),
          (output) =>
            Effect.sync(() =>
              notify(() =>
                observer.nodeCompleted({
                  nodeId: this.id,
                  output,
                  durationMs: Date.now() - startedAt,
                  ...(context?.runId === undefined ? {} : { runId: context.runId }),
                }),
              ),
            ),
        ),
        (error) =>
          Effect.sync(() =>
            notify(() =>
              observer.nodeFailed({
                nodeId: this.id,
                error,
                durationMs: Date.now() - startedAt,
                ...(context?.runId === undefined ? {} : { runId: context.runId }),
              }),
            ),
          ),
      )
    }
  }

  then<Next>(next: Node<Output, Next>): Node<Input, Next>
  then<Next>(next: (output: Output) => NodeRun<Next> | Next): Node<Input, Next>
  then<Next>(next: Node<Output, Next> | ((output: Output) => NodeRun<Next> | Next)): Node<Input, Next> {
    return new Node(
      Id.childNode(this.id, "then"),
      (input, context) =>
        Effect.flatMap(this.execute(input, context), (output) =>
          next instanceof Node ? next.execute(output, context) : toEffect(next(output)),
        ),
      this.triggers,
      false,
    )
  }

  tap(effect: Node<Output, unknown>): Node<Input, Output> {
    return new Node(
      Id.childNode(this.id, "tap"),
      (input, context) =>
        Effect.flatMap(this.execute(input, context), (output) => Effect.as(effect.execute(output, context), output)),
      this.triggers,
      false,
    )
  }

  map<Next>(transform: (output: Output) => Next): Node<Input, Next> {
    return new Node(
      Id.childNode(this.id, "map"),
      (input, context) => Effect.map(this.execute(input, context), transform),
      this.triggers,
      false,
    )
  }

  mapEach<Item, Next>(this: Node<Input, readonly Item[]>, next: Node<Item, Next>): Node<Input, readonly Next[]>
  mapEach<Item, Next>(
    this: Node<Input, readonly Item[]>,
    next: (item: Item) => NodeRun<Next> | Next,
  ): Node<Input, readonly Next[]>
  mapEach<Item, Next>(
    this: Node<Input, readonly Item[]>,
    next: Node<Item, Next> | ((item: Item) => NodeRun<Next> | Next),
  ): Node<Input, readonly Next[]> {
    return new Node(
      Id.childNode(this.id, "map-each"),
      (input, context) =>
        Effect.flatMap(this.execute(input, context), (items) =>
          Effect.all(
            items.map((item) => (next instanceof Node ? next.execute(item, context) : toEffect(next(item)))),
            { concurrency: "unbounded" },
          ),
        ),
      this.triggers,
      false,
    )
  }

  forEach<Item, Next>(
    this: Node<Input, readonly Item[]>,
    next: (item: Node<Item, Item>) => Node<unknown, Next>,
  ): Node<Input, readonly Next[]> {
    return new Node(
      Id.childNode(this.id, "forEach"),
      (input, context) =>
        Effect.flatMap(this.execute(input, context), (items) =>
          Effect.all(
            items.map((item, index) =>
              next(new Node(Id.childNode(this.id, `[${index}]`), () => Effect.succeed(item), [], false)).execute(
                item,
                context,
              ),
            ),
            { concurrency: "unbounded" },
          ),
        ),
      this.triggers,
      false,
    )
  }

  fanout<Branches extends Record<string, Node<unknown, unknown>>>(
    branches: Branches,
  ): Node<Input, FanoutOutputs<Branches>> {
    return new Node<Input, FanoutOutputs<Branches>>(
      Id.childNode(this.id, "fanout"),
      (input, context) =>
        Effect.flatMap(
          this.execute(input, context),
          (output) =>
            Effect.all(
              Object.fromEntries(
                Object.entries(branches).map(([key, branch]) => [key, branch.execute(output, context)]),
              ),
              { concurrency: "unbounded" },
            ) as unknown as NodeRun<FanoutOutputs<Branches>>,
        ),
      this.triggers,
      false,
    )
  }
}

export type NodeInput<N> = N extends Node<infer Input, unknown> ? Input : never
export type NodeOutput<N> = N extends Node<unknown, infer Output> ? Output : never
export type FanoutOutputs<B extends Record<string, Node<unknown, unknown>>> = { [K in keyof B]: NodeOutput<B[K]> }
export type Trigger<Output> = Node<void, Output>
export type EffectNode<Input> = Node<Input, void>

function toEffect<Output>(value: NodeRun<Output> | Output): NodeRun<Output> {
  return value && typeof value === "object" && "_tag" in value
    ? (value as NodeRun<Output>)
    : Effect.succeed(value as Output)
}
