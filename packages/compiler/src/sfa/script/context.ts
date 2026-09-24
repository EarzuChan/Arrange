import type { BindingMetadata } from '../../core/index.ts'
import { generateCodeFrame, isArray } from '@arrange/shared'
import { type ParserPlugin, parse as babelParse } from '@babel/parser'
import type { CallExpression, Node, ObjectPattern, Program } from '@babel/types'
import MagicString from 'magic-string'
import type { ImportBinding, SFAScriptCompileOptions } from '../compileScript.ts'
import type { SFADescriptor } from '../parse.ts'
import { warn } from '../warn.ts'
import { normalizeSfaUnitSyntax, restoreBabelNodePositions } from '../../core/unitSyntax.ts'
import type { PropsDestructureBindings } from './defineProps.ts'
import type { TypeScope } from './resolveType.ts'

export class ScriptCompileContext {
    readonly isTS = true

    scriptAst: Program | null

    source: string
    filename: string
    s: MagicString
    startOffset: number | undefined
    endOffset: number | undefined

    // import / type 分析
    scope?: TypeScope
    globalScopes?: TypeScope[]
    userImports: Record<string, ImportBinding> = Object.create(null)

    // macros presence check
    hasDefinePropsCall = false

    // 定义Props
    propsCall: CallExpression | undefined
    propsDecl: Node | undefined
    propsRuntimeDecl: Node | undefined
    propsTypeDecl: Node | undefined
    propsDestructureDecl: ObjectPattern | undefined
    propsDestructuredBindings: PropsDestructureBindings = Object.create(null)
    propsDestructureRestId: string | undefined
    propsRuntimeDefaults: Node | undefined

    // 代码生成
    bindingMetadata: BindingMetadata = {}
    helperImports: Set<string> = new Set()
    helper(key: string): string {
        this.helperImports.add(key)
        return `_${key}`
    }

    // 要暴露在编译的脚本块儿以便HMR这那的
    deps?: Set<string>

    // 已解析fs的缓存
    fs?: NonNullable<SFAScriptCompileOptions['fs']>

    constructor(public descriptor: SFADescriptor, public options: Partial<SFAScriptCompileOptions>) {
        this.source = descriptor.source
        this.filename = descriptor.filename
        this.s = new MagicString(this.source)
        this.startOffset = descriptor.script?.loc.start.offset
        this.endOffset = descriptor.script?.loc.end.offset

        const plugins = resolveParserPlugins('ts', options.babelParserPlugins)

        function parse(input: string, offset: number): Program {
            try {
                const normalized = normalizeSfaUnitSyntax(input)
                const program = babelParse(normalized.content, {
                    plugins,
                    sourceType: 'module',
                }).program
                restoreBabelNodePositions(program, normalized.restore)
                return program
            } catch (e: any) {
                e.message = `[Arrange/SFA] ${e.message}\n\n${descriptor.filename}\n${generateCodeFrame(descriptor.source, e.pos + offset, e.pos + offset + 1)}`
                throw e
            }
        }

        this.scriptAst = descriptor.script && parse(descriptor.script!.content, this.startOffset!)
    }

    getString(node: Node): string {
        return this.descriptor.script!.content.slice(node.start!, node.end!)
    }

    warn(msg: string, node: Node, scope?: TypeScope): void {
        warn(generateError(msg, node, this, scope))
    }

    error(msg: string, node: Node, scope?: TypeScope): never {
        throw new Error(`[Arrange/SFA] ${generateError(msg, node, this, scope)}`)
    }
}

function generateError(msg: string, node: Node, ctx: ScriptCompileContext, scope?: TypeScope) {
    const offset = scope ? scope.offset : ctx.startOffset!
    return `${msg}\n\n${(scope || ctx.descriptor).filename}\n${generateCodeFrame((scope || ctx.descriptor).source, node.start! + offset, node.end! + offset)}`
}

export function resolveParserPlugins(lang: string, userPlugins?: ParserPlugin[], dts = false): ParserPlugin[] {
    const plugins: ParserPlugin[] = []
    if (
        !userPlugins || !userPlugins.some(p => p === 'importAssertions' || p === 'importAttributes' || (isArray(p) && p[0] === 'importAttributes'))
    ) {
        plugins.push('importAttributes')
    }
    if (lang === 'jsx' || lang === 'tsx' || lang === 'mtsx') {
        plugins.push('jsx')
    } else if (userPlugins) {
        // If don't match the case of adding jsx
        // should remove the jsx from user options
        userPlugins = userPlugins.filter(p => p !== 'jsx')
    }
    if (
        lang === 'ts' || lang === 'mts' || lang === 'tsx' || lang === 'cts' || lang === 'mtsx'
    ) {
        plugins.push(['typescript', { dts }], 'explicitResourceManagement')
        if (!userPlugins || !userPlugins.includes('decorators')) {
            plugins.push('decorators-legacy')
        }
    }
    if (userPlugins) {
        plugins.push(...userPlugins)
    }
    return plugins
}
