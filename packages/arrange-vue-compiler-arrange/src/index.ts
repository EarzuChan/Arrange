import {
    baseCompile,
    baseParse,
    type CodegenResult,
    type CompilerOptions,
    type NodeTransform,
    NodeTypes,
    type ParserOptions,
    type RootNode,
} from '@arrange/vue-compiler-core'
import { acceptsHostInput, camelize, isHostTag, toHandlerKey } from '@arrange/vue-shared'
import { parserOptions } from './parserOptions.ts'

export { parserOptions }

// 只校验原厂宿主输入，用户组件自行定义 props 与事件
const validateNativeTemplate: NodeTransform = (node, context) => {
    if (node.type !== NodeTypes.ELEMENT) return
    const fail = (message: string, loc = node.loc) => {
        context.onError(Object.assign(new SyntaxError(message), { code: 'ARRANGE_TEMPLATE', loc }))
    }
    const host = isHostTag(node.tag) ? node.tag : null
    for (const prop of node.props) {
        const name = prop.type === NodeTypes.ATTRIBUTE ? prop.name
            : prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic ? prop.arg.content : null
        if (host && name && !['key', 'ref', 'ref_for', 'ref_key'].includes(name) && !acceptsHostInput(host, name)) fail(`Arrange <${host}> 没有输入 ${name}，请检查组件 schema`, prop.loc)
        if (prop.type !== NodeTypes.DIRECTIVE) continue
        if (!['bind', 'on', 'model', 'if', 'else', 'else-if', 'for', 'slot', 'once', 'memo'].includes(prop.name)) fail(`Arrange 缺少 v-${prop.name} 的宿主转换`, prop.loc)
        if (prop.modifiers.length && !(prop.name === 'bind' && prop.modifiers.every(modifier => modifier.content === 'camel'))) fail(`Arrange v-${prop.name} 没有匹配的修饰符转换`, prop.loc)
        if (host && prop.name === 'model' && host !== 'Input') fail(`Arrange <${host}> 没有受控输入模型`, prop.loc)
        if (host && prop.name === 'on' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic && !acceptsHostInput(host, toHandlerKey(camelize(prop.arg.content)))) fail(`Arrange <${host}> 没有事件 ${prop.arg.content}`, prop.loc)
    }
}

export function compile(src: string | RootNode, options: CompilerOptions = {}): CodegenResult {
    return baseCompile(src, {
        ...parserOptions,
        ...options,
        nodeTransforms: [validateNativeTemplate, ...(options.nodeTransforms ?? [])],
        // 原生 v-model 使用 core 生成的 modelValue 和 onUpdate:modelValue

        transformHoist: null,
    })
}

export function parse(template: string, options: ParserOptions = {}): RootNode {
    return baseParse(template, { ...parserOptions, ...options })
}

export * from '@arrange/vue-compiler-core'
