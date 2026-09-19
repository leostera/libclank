import { Node, type EffectNode, type NodeFunction } from "./node.js"
import type { NodeId } from "./id.js"

export type Task<Input, Output> = Node<Input, Output>

export const Task = {
  fn<Input, Output>(options: { id: NodeId; run: NodeFunction<Input, Output> }): Task<Input, Output> {
    return new Node(options.id, options.run)
  },

  effect<Input>(options: { id: NodeId; run: NodeFunction<Input, void> }): EffectNode<Input> {
    return new Node(options.id, options.run)
  },
}
