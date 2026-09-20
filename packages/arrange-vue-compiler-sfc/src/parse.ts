import * as ArrangeCompiler from '@arrange/vue-compiler-arrange'
import { type BindingMetadata, type CompilerError, type ElementNode, NodeTypes, type ParserOptions, type RawSourceMap, type RootNode, type SourceLocation, createRoot } from '@arrange/vue-compiler-core'
import { genCacheKey } from '@arrange/vue-shared'
import { SourceMapGenerator } from 'source-map-js'
import { createCache } from './cache.ts'
import type { ImportBinding } from './compileScript.ts'

export const DEFAULT_FILENAME = 'anonymous.sfa'

export interface SFAParseOptions {
    filename?: string
    sourceMap?: boolean
    sourceRoot?: string
    templateParseOptions?: ParserOptions
}

export interface SFABlock {
    type: string
    content: string
    loc: SourceLocation
    map?: RawSourceMap
}

export interface SFATemplateBlock extends SFABlock {
    type: 'template'
    ast?: RootNode
}

export interface SFAScriptBlock extends SFABlock {
    type: 'script'
    bindings?: BindingMetadata
    imports?: Record<string, ImportBinding>
    scriptAst?: import('@babel/types').Statement[]
    deps?: string[]
}

export interface SFADescriptor {
    filename: string
    source: string
    template: SFATemplateBlock | null
    script: SFAScriptBlock | null
}

export interface SFAParseResult {
    descriptor: SFADescriptor
    errors: (CompilerError | SyntaxError)[]
}

export const parseCache = createCache<SFAParseResult>()

export function parse(source: string, options: SFAParseOptions = {}): SFAParseResult {
    const key = genCacheKey(source, options)
    const cached = parseCache.get(key)
    if (cached) return cached

    const { filename = DEFAULT_FILENAME, sourceMap = true, sourceRoot = '', templateParseOptions = {} } = options
    const descriptor: SFADescriptor = { filename, source, template: null, script: null }
    const errors: (CompilerError | SyntaxError)[] = []
    const fail = (message: string, loc: SourceLocation) => errors.push(Object.assign(new SyntaxError(message), { loc }))
    const ast = ArrangeCompiler.parse(source, { ...templateParseOptions, parseMode: 'sfa', prefixIdentifiers: true, onError: error => errors.push(error) })
    for (const node of ast.children) {
        if (node.type === NodeTypes.COMMENT || node.type === NodeTypes.TEXT && !node.content.trim()) continue
        if (node.type !== NodeTypes.ELEMENT || node.tag !== 'template' && node.tag !== 'script') {
            fail('SFA 顶层只接受 template 与 script 区块', node.loc)
            continue
        }
        if (node.props.length) {
            fail(`SFA 的 <${node.tag}> 不接受属性`, node.props[0].loc)
            continue
        }
        if (descriptor[node.tag]) {
            fail(`SFA 只能包含一个 <${node.tag}> 区块`, node.loc)
            continue
        }

        const block = createBlock(node, source)
        if (sourceMap) block.map = generateSourceMap(filename, source, block, sourceRoot)
        if (node.tag === 'template') descriptor.template = { ...block, type: 'template', ast: createRoot(node.children, source) }
        else descriptor.script = { ...block, type: 'script' }
    }
    if (!descriptor.template && !descriptor.script && !errors.length) errors.push(new SyntaxError(`SFA 至少需要一个 template 或 script 区块：${filename}`))

    const result = { descriptor, errors }
    parseCache.set(key, result)
    return result
}

function createBlock(node: ElementNode, source: string): SFABlock {
    const loc = node.innerLoc!
    return { type: node.tag, content: source.slice(loc.start.offset, loc.end.offset), loc }
}

function generateSourceMap(filename: string, source: string, block: SFABlock, sourceRoot: string): RawSourceMap {
    const map = new SourceMapGenerator({ file: filename.replace(/\\/g, '/'), sourceRoot: sourceRoot.replace(/\\/g, '/') })
    map.setSourceContent(filename, source)
    const lines = block.content.split(/\r?\n/)
    for (let row = 0; row < lines.length; row++) {
        for (let column = 0; column < lines[row].length; column++) {
            map.addMapping({ source: filename, generated: { line: row + 1, column }, original: { line: block.loc.start.line + row, column: column + (row === 0 ? block.loc.start.column - 1 : 0) } })
        }
    }
    return JSON.parse(map.toString())
}
