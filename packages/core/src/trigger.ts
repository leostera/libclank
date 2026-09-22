import { Effect } from "effect"
import { Id, type TriggerId } from "./id.js"
import { Node, type Trigger, type TriggerDefinition } from "./node.js"

export const Triggers = {
  webhook<Output>(options: {
    id: TriggerId
    path?: string
    decode?: (request: Request) => Output | Promise<Output>
  }): Trigger<Output> {
    const nodeId = Id.node()
    const definition: TriggerDefinition<Output> = {
      ...options,
      nodeId,
      kind: "webhook",
      path: options.path ?? `/hooks/${Id.name(options.id)}`,
    }
    return new Node(
      nodeId,
      (_, context) => {
        const value = context?.triggerValues.get(options.id)
        return value === undefined
          ? Effect.die(new Error(`Trigger ${options.id} has not been activated`))
          : Effect.succeed(value as Output)
      },
      [definition],
    )
  },

  manual(options: { id: TriggerId }): Trigger<void> {
    const nodeId = Id.node()
    const definition: TriggerDefinition<void> = {
      id: options.id,
      nodeId,
      kind: "manual",
      path: `/run/${Id.name(options.id)}`,
    }
    return new Node(nodeId, () => Effect.succeed(undefined), [definition])
  },

  cron<Output>(options: { id: TriggerId; schedule: string; value: Output }): Trigger<Output> {
    const nodeId = Id.node()
    const definition: TriggerDefinition<Output> = { ...options, nodeId, kind: "cron" }
    return new Node(
      nodeId,
      (_, context) => Effect.succeed((context?.triggerValues.get(options.id) ?? options.value) as Output),
      [definition],
    )
  },
}
