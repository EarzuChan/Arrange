import { type ElementNode, type ForNode, type IfNode, NodeTypes } from '../ast.ts'
import { SET_BLOCK_TRACKING } from '../runtimeHelpers.ts'
import type { NodeTransform } from '../transform.ts'
import { findDir } from '../utils.ts'

const seen = new WeakSet()

export const transformOnce: NodeTransform = (node, context) => {
    if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
        if ((seen.has(node) || context.inVOnce)) {
            return
        }
        seen.add(node)
        context.inVOnce = true
        context.helper(SET_BLOCK_TRACKING)
        return () => {
            context.inVOnce = false
            const cur = context.currentNode as ElementNode | IfNode | ForNode
            if (cur.codegenNode) {
                cur.codegenNode = context.cache(
                    cur.codegenNode,
                    true /* isVNode */,
                    true /* inVOnce */,
                )
            }
        }
    }
}
