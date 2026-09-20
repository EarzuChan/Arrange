import { NodeTypes, createCallExpression } from '../ast.ts'
import { RENDER_SLOT } from '../runtimeHelpers.ts'
import type { NodeTransform } from '../transform.ts'
import { findProp, isSlotOutlet } from '../utils.ts'

// Slot 只声明并调用静态名称，控制流由结构转换负责
export const transformSlotOutlet: NodeTransform = (node, context) => {
    if (!isSlotOutlet(node)) return
    const name = node.props.find(prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'name')
    const slotName = name?.type === NodeTypes.ATTRIBUTE ? name.value!.content : 'default'
    const key = findProp(node, 'key', false, true)
    node.codegenNode = createCallExpression(context.helper(RENDER_SLOT), [context.prefixIdentifiers ? '_ctx.$slots' : '$slots', JSON.stringify(slotName), ...(key?.type === NodeTypes.ATTRIBUTE ? [JSON.stringify(key.value?.content ?? true)] : key?.exp ? [key.exp] : [])], node.loc)
}
