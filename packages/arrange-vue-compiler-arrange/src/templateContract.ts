import { ElementTypes, NodeTypes, type CompilerOptions, type RootNode, type SourceLocation, type TemplateChildNode } from '@arrange/vue-compiler-core'
import { camelize } from '@arrange/vue-shared'

// 在结构转换之前检查源码契约，不能让被转换掉的指令绕过校验
export function validateTemplateContract(root: RootNode, options: CompilerOptions): string[] { // Options 未被使用喵
    const slots = new Set<string>()

    const fail = (message: string, loc: SourceLocation): never => {throw Object.assign(new SyntaxError(message), { code: 'ARRANGE_TEMPLATE', loc })}

    const visit = (children: TemplateChildNode[]) => {
        for (let index = children.length - 1; index >= 0; index--) {
            const node = children[index]
            if (node.type === NodeTypes.TEXT) {
                if (node.content.trim()) fail('模板内容不接受裸文本，请使用 Text 的 text 参数', node.loc)
                children.splice(index, 1)
                continue
            }
            if (node.type === NodeTypes.INTERPOLATION) fail('模板内容不接受插值，请使用 Text 的 text 参数', node.loc)
            if (node.type !== NodeTypes.ELEMENT) continue

            if (!/^[A-Z][A-Za-z0-9]*$/.test(node.tag)) fail(`Arrangable 标签必须使用准确的 PascalCase 名称：${node.tag}`, node.loc)
            const names = new Set<string>()
            for (const prop of node.props) {
                if (prop.type === NodeTypes.DIRECTIVE) {
                    if (!['bind', 'if', 'else-if', 'else', 'for', 'slot'].includes(prop.name)) fail(`Arrange 模板不支持 v-${prop.name}`, prop.loc)
                    if (prop.modifiers.length && !(prop.name === 'bind' && prop.modifiers.every(modifier => modifier.content === 'camel'))) fail(`v-${prop.name} 不支持这些修饰符`, prop.loc)
                    if (prop.name === 'bind' && (!prop.exp || prop.exp.type === NodeTypes.SIMPLE_EXPRESSION && !prop.exp.content.trim())) fail('参数绑定必须显式提供表达式', prop.loc)
                    if (prop.name === 'slot' && (node.tag !== 'Template' || prop.exp || prop.arg && (prop.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !prop.arg.isStatic || prop.arg.content.includes('.')))) fail('具名内容必须使用 Template 和静态槽位名，不接受槽位参数或修饰符', prop.loc)
                }

                const original = prop.type === NodeTypes.ATTRIBUTE ? prop.name : prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic ? prop.arg.content : undefined
                if (original === undefined) continue
                const name = camelize(original)
                if (name === 'ref' || name === 'refFor' || name === 'refKey') fail('模板不提供实例 ref，请通过已声明的参数传递状态', prop.loc)
                if (names.has(name)) fail(`重复参数：${name}`, prop.loc)
                names.add(name)
            }

            if (node.tag === 'Slot') {
                let name = 'default'

                for (const prop of node.props) {
                    if (prop.type === NodeTypes.DIRECTIVE && ['if', 'else', 'else-if', 'for'].includes(prop.name)) continue
                    if (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'key' || prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic && prop.arg.content === 'key') continue
                    if (prop.type !== NodeTypes.ATTRIBUTE || prop.name !== 'name' || !prop.value?.content) fail('Slot 只接受静态 name，不接受业务参数', prop.loc)
                    if (prop.type === NodeTypes.ATTRIBUTE) name = prop.value!.content
                }

                if (node.children.some(child => child.type !== NodeTypes.COMMENT && !(child.type === NodeTypes.TEXT && !child.content.trim()))) fail('Slot 未被提供时为空内容，不接受默认子内容', node.loc)
                slots.add(name)
                node.tagType = ElementTypes.SLOT
            } else if (node.tag === 'Template') node.tagType = ElementTypes.TEMPLATE

            visit(node.children)
        }
    }

    visit(root.children)
    return [...slots]
}
