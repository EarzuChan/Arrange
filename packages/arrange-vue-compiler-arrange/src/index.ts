import {
    baseCompile,
    baseParse,
    NodeTypes,
    type CodegenResult,
    type CompilerOptions,
    type NodeTransform,
    type ParserOptions,
    type RootNode,
} from '@arrange/vue-compiler-core'
import {parserOptions} from './parserOptions.ts'

export {parserOptions}

// 原生宿主不接受浏览器语义；在源码位置报错，不能静默丢弃
const validateNativeTemplate: NodeTransform = (node, context) => {
    if (node.type !== NodeTypes.ELEMENT) return
    const fail = (message: string, loc = node.loc) => {
        context.onError(Object.assign(new SyntaxError(message), {code: 'ARRANGE_TEMPLATE', loc}))
    }
    if (/^[a-z]/.test(node.tag) && !['template', 'slot', 'component'].includes(node.tag)) {
        fail(`Arrange 不支持 <${node.tag}>；请使用原生元素或组件`)
    }
    for (const prop of node.props) {
        const name = prop.type === NodeTypes.ATTRIBUTE ? prop.name
            : prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic ? prop.arg.content : null
        if (name === 'class' || name === 'style') fail(`Arrange 不支持 ${name}，请使用 Modifier`, prop.loc)
        if (prop.type !== NodeTypes.DIRECTIVE) continue
        if (['html', 'text', 'show', 'cloak'].includes(prop.name)) fail(`Arrange 不支持 v-${prop.name}`, prop.loc)
        if (prop.name === 'on' && prop.modifiers.length) fail('Arrange 事件不支持浏览器修饰符', prop.loc)
        if (prop.name === 'bind' && prop.modifiers.some(modifier => modifier.content !== 'camel')) fail('Arrange v-bind 仅支持 .camel 修饰符', prop.loc)
    }
}

export function compile(src: string | RootNode, options: CompilerOptions = {}): CodegenResult {
    return baseCompile(src, {
        ...parserOptions,
        ...options,
        nodeTransforms: [validateNativeTemplate, ...(options.nodeTransforms ?? [])],
        // 原生 v-model 使用 core 生成的 modelValue 和 onUpdate:modelValue
        // 不引入 DOM 指令、事件监听器或 HTML 字符串静态化
        transformHoist: null,
    })
}

export function parse(template: string, options: ParserOptions = {}): RootNode {
    return baseParse(template, {...parserOptions, ...options})
}

export * from '@arrange/vue-compiler-core'
