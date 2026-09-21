import * as ArrangeCompiler from '../template/index.ts'
import { type CodegenResult, type CompilerError, type CompilerOptions, type ElementNode, NodeTypes, type ParserOptions, type RawSourceMap, type RootNode, createRoot } from '../core/index.ts'
import { generateCodeFrame } from '@arrange/shared'
import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js'

export interface TemplateCompiler {
    compile(source: string | RootNode, options: CompilerOptions): CodegenResult
    parse(template: string, options: ParserOptions): RootNode
}

export interface SFATemplateCompileResults {
    code: string
    ast?: RootNode
    preamble?: string
    source: string
    tips: string[]
    errors: (string | CompilerError)[]
    map?: RawSourceMap
}

export interface SFATemplateCompileOptions {
    source: string
    ast?: RootNode
    filename: string
    isProd?: boolean
    inMap?: RawSourceMap
    compilerOptions?: CompilerOptions
}

export function compileTemplate({ filename, inMap, source, ast: inputAst, isProd = false, compilerOptions = {} }: SFATemplateCompileOptions): SFATemplateCompileResults {
    const errors: CompilerError[] = []
    const warnings: CompilerError[] = []

    if (inputAst?.transformed) {
        const parsed = ArrangeCompiler.parse(inputAst.source, { ...compilerOptions, parseMode: 'sfa', onError: error => errors.push(error) })
        const template = parsed.children.find(node => node.type === NodeTypes.ELEMENT && node.tag === 'template') as ElementNode
        inputAst = createRoot(template.children, inputAst.source)
    }

    let { code, ast, preamble, map } = ArrangeCompiler.compile(inputAst || source, {
        mode: 'module',
        prefixIdentifiers: true,
        hoistStatic: true,
        sourceMap: true,
        ...compilerOptions,
        hmr: !isProd,
        filename,
        onError: error => errors.push(error),
        onWarn: warning => warnings.push(warning),
    })

    // 将模板内的位置映射回完整 SFA，运行时和编译器共享源文件坐标
    if (inMap && !inputAst) {
        if (map) map = mapLines(inMap, map)
        const offset = inMap.sourcesContent![0].indexOf(source)
        const lineOffset = inMap.sourcesContent![0].slice(0, offset).split(/\r?\n/).length - 1

        for (const error of errors) {
            if (!error.loc) continue
            error.loc.start.line += lineOffset
            error.loc.start.offset += offset
            if (error.loc.end !== error.loc.start) {
                error.loc.end.line += lineOffset
                error.loc.end.offset += offset
            }
        }
    }

    const tips = warnings.map(warning => warning.loc ? `${warning.message}\n${generateCodeFrame(inputAst?.source || source, warning.loc.start.offset, warning.loc.end.offset)}` : warning.message)
    return { code, ast, preamble, source, errors, tips, map }
}

function mapLines(oldMap: RawSourceMap, newMap: RawSourceMap): RawSourceMap {
    const oldConsumer = new SourceMapConsumer(oldMap)
    const newConsumer = new SourceMapConsumer(newMap)
    const merged = new SourceMapGenerator()

    newConsumer.eachMapping(mapping => {
        if (mapping.originalLine == null || mapping.originalColumn == null) return
        const original = oldConsumer.originalPositionFor({ line: mapping.originalLine, column: mapping.originalColumn })
        if (original.source == null || original.line == null || original.column == null) return
        merged.addMapping({ generated: { line: mapping.generatedLine, column: mapping.generatedColumn }, original: { line: original.line, column: original.column + mapping.originalColumn }, source: original.source, name: mapping.name ?? undefined })
    })

    for (const source of oldConsumer.sources) merged.setSourceContent(source, oldConsumer.sourceContentFor(source))
    return JSON.parse(merged.toString())
}