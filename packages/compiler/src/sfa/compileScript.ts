import { BindingTypes, UNREF, isFunctionType, unwrapTSNode, walkIdentifiers } from '../template/index.ts'
import { generateCodeFrame } from '@arrange/shared'
import type { ParserPlugin } from '@babel/parser'
import type { ArrayPattern, CallExpression, Declaration, Identifier, LVal, Node, ObjectPattern, Statement } from '@babel/types'
import { walk } from 'estree-walker'
import { type RawSourceMap, SourceMapConsumer, SourceMapGenerator } from 'source-map-js'
import { type SFATemplateCompileOptions, compileTemplate } from './compileTemplate.ts'
import { DEFAULT_FILENAME, type SFADescriptor, type SFAScriptBlock } from './parse.ts'
import { ScriptCompileContext } from './script/context.ts'
import { DEFINE_PROPS, WITH_DEFAULTS, genRuntimeProps, processDefineProps } from './script/defineProps.ts'
import { transformDestructuredProps } from './script/definePropsDestructure.ts'
import { getImportedName, isCallOf, isLiteralNode } from './script/utils.ts'
import { warnOnce } from './warn.ts'
import { lowerSfaValues } from './lowerValues.ts'

export interface SFAScriptCompileOptions {
    isProd?: boolean
    sourceMap?: boolean
    babelParserPlugins?: ParserPlugin[]
    globalTypeFiles?: string[]
    genDefaultAs?: string
    templateOptions?: Partial<SFATemplateCompileOptions>
    hoistStatic?: boolean
    propsDestructure?: boolean | 'error'
    fs?: {
        fileExists(file: string): boolean
        readFile(file: string): string | undefined
        realpath?(file: string): string
    }
}

export interface ImportBinding {
    isType: boolean
    imported: string
    local: string
    source: string
}

const MACROS = [
    DEFINE_PROPS,
    WITH_DEFAULTS,
]

// 唯一的 TS setup 脚本模式，模板直接共享实例词法作用域
export function compileScript(sfa: SFADescriptor, options: SFAScriptCompileOptions): SFAScriptBlock {
    const script = generateSfaScript(sfa, options)
    const lowered = lowerSfaValues(script.content, sfa.filename, script.map)
    return { ...script, content: lowered.content, map: lowered.map, deps: [...new Set([...script.deps ?? [], ...lowered.deps])] }
}

// 生成保有单位声明的中间 TS，供当前文件及跨 SFA 契约分析共同使用
export function generateSfaScript(sfa: SFADescriptor, options: SFAScriptCompileOptions): SFAScriptBlock {
    const { script, source, filename } = sfa
    if (!script) throw new Error('SFA 没有可编译的 script 区块')
    const hoistStatic = options.hoistStatic !== false
    const ctx = new ScriptCompileContext(sfa, options)
    const setupBindings: Record<string, BindingTypes> = Object.create(null)
    const startOffset = ctx.startOffset!
    const endOffset = ctx.endOffset!

    function hoistNode(node: Statement) {
        const start = node.start! + startOffset
        let end = node.end! + startOffset
        if (node.trailingComments && node.trailingComments.length > 0) {
            const lastCommentNode = node.trailingComments[node.trailingComments.length - 1]
            end = lastCommentNode.end! + startOffset
        }
        while (end <= source.length) {
            if (!/\s/.test(source.charAt(end))) {
                break
            }
            end++
        }
        ctx.s.move(start, end, 0)
    }

    function registerUserImport(source: string, local: string, imported: string, isType: boolean) {
        ctx.userImports[local] = { isType, imported, local, source }
    }

    function checkInvalidScopeReference(node: Node | undefined, method: string) {
        if (!node) return
        walkIdentifiers(node, id => {
            const binding = setupBindings[id.name]
            if (binding && binding !== BindingTypes.LITERAL_CONST) {
                ctx.error(`${method}() 的声明会提升到模块，不能读取实例局部变量；共享定义请移入独立 TS 模块`, id)
            }
        })
    }

    const scriptAst = ctx.scriptAst!

    for (const node of scriptAst.body) {
        if (node.type === 'ImportDeclaration') {
            hoistNode(node)

            let removed = 0
            const removeSpecifier = (i: number) => {
                const removeLeft = i > removed
                removed++
                const current = node.specifiers[i]
                const next = node.specifiers[i + 1]
                ctx.s.remove(removeLeft ? node.specifiers[i - 1].end! + startOffset : current.start! + startOffset, next && !removeLeft ? next.start! + startOffset : current.end! + startOffset)
            }

            for (let i = 0; i < node.specifiers.length; i++) {
                const specifier = node.specifiers[i]
                const local = specifier.local.name
                const imported = getImportedName(specifier)
                const source = node.source.value
                const existing = ctx.userImports[local]
                if ((source === '@arrange/framework/internal' || source === '@arrange/framework') && MACROS.includes(imported)) {
                    if (local === imported) {
                        warnOnce(`\`${imported}\` is a compiler macro and no longer needs to be imported.`)
                    } else {
                        ctx.error(`\`${imported}\` is a compiler macro and cannot be aliased to ` + `a different name.`, specifier)
                    }
                    removeSpecifier(i)
                } else if (existing) {
                    if (existing.source === source && existing.imported === imported) {
                        removeSpecifier(i)
                    } else {
                        ctx.error(`different imports aliased to same local name.`, specifier)
                    }
                } else {
                    registerUserImport(source, local, imported, node.importKind === 'type' || (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'))
                }
            }
            if (node.specifiers.length && removed === node.specifiers.length) {
                ctx.s.remove(node.start! + startOffset, node.end! + startOffset)
            }
        }
    }

    const arrangeImportAliases: Record<string, string> = {}
    for (const key in ctx.userImports) {
        const { source, imported, local } = ctx.userImports[key]
        if ((source === '@arrange/framework')) arrangeImportAliases[imported] = local
    }

    for (const node of scriptAst.body) {
        if (node.type === 'ExpressionStatement' && processDefineProps(ctx, unwrapTSNode(node.expression))) {
            ctx.s.remove(node.start! + startOffset, node.end! + startOffset)
        }

        if (node.type === 'VariableDeclaration' && !node.declare) {
            const total = node.declarations.length
            let left = total
            let lastNonRemoved: number | undefined

            for (let i = 0; i < total; i++) {
                const decl = node.declarations[i]
                const init = decl.init && unwrapTSNode(decl.init)
                if (init) {
                    const isDefineProps = processDefineProps(ctx, init, decl.id as LVal)
                    if (ctx.propsDestructureRestId) {
                        setupBindings[ctx.propsDestructureRestId] = BindingTypes.SETUP_REACTIVE_CONST
                    }

                    if (
                        isDefineProps && !ctx.propsDestructureRestId && ctx.propsDestructureDecl
                    ) {
                        if (left === 1) {
                            ctx.s.remove(node.start! + startOffset, node.end! + startOffset)
                        } else {
                            let start = decl.start! + startOffset
                            let end = decl.end! + startOffset
                            if (i === total - 1) {
                                start = node.declarations[lastNonRemoved!].end! + startOffset
                            } else {
                                end = node.declarations[i + 1].start! + startOffset
                            }
                            ctx.s.remove(start, end)
                            left--
                        }
                    } else {
                        lastNonRemoved = i
                    }
                }
            }
        }

        let isAllLiteral = false
        if (
            (node.type === 'VariableDeclaration' || node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'TSEnumDeclaration') && !node.declare
        ) {
            isAllLiteral = walkDeclaration(node, setupBindings, arrangeImportAliases, hoistStatic, !!ctx.propsDestructureDecl)
        }

        if (hoistStatic && isAllLiteral) {
            hoistNode(node)
        }

        if (
            (node.type === 'VariableDeclaration' && !node.declare) || node.type.endsWith('Statement')
        ) {
            walk(node, {
                enter(child: Node) {
                    if (isFunctionType(child)) {
                        this.skip()
                    }
                    if (child.type === 'AwaitExpression' || child.type === 'ForOfStatement' && child.await) {
                        ctx.error('SFA 初始化必须同步；异步加载请通过明确状态与控制流表达', child)
                    }
                },
            })
        }

        if (
            node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportDefaultDeclaration'
        ) {
            ctx.error('SFA script 不接受模块导出，请将共享逻辑和类型导出放入独立 TS 模块', node)
        }

        if (ctx.isTS) {
            if (
                node.type.startsWith('TS') || (node.type === 'ExportNamedDeclaration' && node.exportKind === 'type') || (node.type === 'VariableDeclaration' && node.declare)
            ) {
                if (node.type !== 'TSEnumDeclaration') {
                    hoistNode(node)
                }
            }
        }
    }

    if (ctx.propsDestructureDecl) {
        transformDestructuredProps(ctx, arrangeImportAliases)
    }

    checkInvalidScopeReference(ctx.propsRuntimeDecl, DEFINE_PROPS)
    checkInvalidScopeReference(ctx.propsRuntimeDefaults, DEFINE_PROPS)
    checkInvalidScopeReference(ctx.propsDestructureDecl, DEFINE_PROPS)
    ctx.s.remove(0, startOffset)
    ctx.s.remove(endOffset, source.length)

    for (const [key, { isType, imported, source }] of Object.entries(ctx.userImports)) {
        if (isType) continue
        if (source === '@arrange/framework/ui' && imported === 'M') {
            (ctx.bindingMetadata.__arrangeModifierRoots ??= []).push(key)
        }
        ctx.bindingMetadata[key] = imported === '*' || (imported === 'default' && source.endsWith('.sfa')) || (source === '@arrange/framework') ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_MAYBE_REF
    }
    for (const key in setupBindings) {
        ctx.bindingMetadata[key] = setupBindings[key]
    }

    // 整理 setup 参数
    let args = ctx.propsTypeDecl ? `__props: ${ctx.getString(ctx.propsTypeDecl)}` : '__props'
    if (ctx.propsDecl) {
        if (ctx.propsDestructureRestId) {
            ctx.s.overwrite(startOffset + ctx.propsCall!.start!, startOffset + ctx.propsCall!.end!, `${ctx.helper(`createPropsRestProxy`)}(__props, ${JSON.stringify(Object.keys(ctx.propsDestructuredBindings))})`)
            ctx.s.overwrite(startOffset + ctx.propsDestructureDecl!.start!, startOffset + ctx.propsDestructureDecl!.end!, ctx.propsDestructureRestId)
        } else if (!ctx.propsDestructureDecl) {
            ctx.s.overwrite(startOffset + ctx.propsCall!.start!, startOffset + ctx.propsCall!.end!, '__props')
        }
    }

    let templateMap
    let slotNames: readonly string[] = []
    let returned
    const propsDecl = genRuntimeProps(ctx)
    if (sfa.template) {

        const { code, ast, preamble, tips, errors, map } = compileTemplate({
            filename,
            ast: sfa.template.ast,
            source: sfa.template.content,
            inMap: sfa.template.map,
            ...options.templateOptions,
            isProd: options.isProd,
            compilerOptions: {
                ...(options.templateOptions && options.templateOptions.compilerOptions),
                inline: true,
                isTS: ctx.isTS,
                bindingMetadata: ctx.bindingMetadata,
            },
        })
        slotNames = ast?.slotNames ?? []
        templateMap = map
        if (tips.length) {
            tips.forEach(warnOnce)
        }
        const err = errors[0]
        if (typeof err === 'string') {
            throw new Error(err)
        } else if (err) {
            if (err.loc) {
                err.message += `\n\n` + sfa.filename + '\n' + generateCodeFrame(source, err.loc.start.offset, err.loc.end.offset) + `\n`
            }
            throw err
        }
        if (preamble) {
            ctx.s.prepend(preamble)
        }

        if (ast && ast.helpers.has(UNREF)) {
            ctx.helperImports.delete('unref')
        }
        returned = code
    } else {
        returned = `() => {}`
    }

    ctx.s.appendRight(endOffset, `\nreturn ${returned}\n}\n\n`)

    const genDefaultAs = options.genDefaultAs ? `const ${options.genDefaultAs} =` : `export default`

    let runtimeOptions = `\n    __file: ${JSON.stringify(filename)},\n    slotNames: ${JSON.stringify(slotNames)},`
    if (filename && filename !== DEFAULT_FILENAME) {
        const match = filename.match(/([^/\\]+)\.\w+$/)
        if (match) {
            runtimeOptions += `\n  __name: '${match[1]}',`
        }
    }

    if (propsDecl) runtimeOptions += `\n  props: ${propsDecl},`

    ctx.s.prependLeft(startOffset, `\n${genDefaultAs} ${ctx.helper('defineArrangable')}({${runtimeOptions}\n    setup(${args}) {\n`)
    ctx.s.appendRight(endOffset, `})`)

    // 汇总 Arrange 编译辅助函数导入
    if (ctx.helperImports.size > 0) {
        const runtimeModuleName = options.templateOptions?.compilerOptions?.runtimeModuleName
        const importSrc = runtimeModuleName ? JSON.stringify(runtimeModuleName) : `'@arrange/framework/internal'`
        ctx.s.prepend(
            `
import { ${[...ctx.helperImports]
                .map(h => `${h} as _${h}`)
                .join(', ')} } from ${importSrc}\n`,
        )
    }

    const content = ctx.s.toString()
    let map =
        options.sourceMap !== false
            ? (ctx.s.generateMap({
                source: filename,
                hires: true,
                includeContent: true,
            }) as unknown as RawSourceMap)
            : undefined
    if (templateMap && map) {
        const offset = content.indexOf(returned)
        const templateLineOffset = content.slice(0, offset).split(/\r?\n/).length - 1
        map = mergeSourceMaps(map, templateMap, templateLineOffset)
    }
    return {
        ...script,
        bindings: ctx.bindingMetadata,
        imports: ctx.userImports,
        content,
        map,
        scriptAst: scriptAst?.body,
        deps: ctx.deps ? [...ctx.deps] : undefined,
    }
}

function registerBinding(bindings: Record<string, BindingTypes>, node: Identifier, type: BindingTypes) {
    bindings[node.name] = type
}

function walkDeclaration(node: Declaration, bindings: Record<string, BindingTypes>, userImportAliases: Record<string, string>, hoistStatic: boolean, isPropsDestructureEnabled = false): boolean {
    let isAllLiteral = false

    if (node.type === 'VariableDeclaration') {
        const isConst = node.kind === 'const'
        isAllLiteral = isConst && node.declarations.every(decl => decl.id.type === 'Identifier' && isStaticNode(decl.init!))

        for (const { id, init: _init } of node.declarations) {
            const init = _init && unwrapTSNode(_init)
            const isConstMacroCall = isConst && isCallOf(init, c => c === DEFINE_PROPS || c === WITH_DEFAULTS)
            if (id.type === 'Identifier') {
                let bindingType
                const userReactiveBinding = userImportAliases['reactive']
                if (
                    hoistStatic && (isAllLiteral || (isConst && isStaticNode(init!)))
                ) {
                    bindingType = BindingTypes.LITERAL_CONST
                } else if (isCallOf(init, userReactiveBinding)) {
                    bindingType = isConst ? BindingTypes.SETUP_REACTIVE_CONST : BindingTypes.SETUP_LET
                } else if (
                    isConstMacroCall || (isConst && canNeverBeRef(init!, userReactiveBinding))
                ) {
                    bindingType = isCallOf(init, DEFINE_PROPS) ? BindingTypes.SETUP_REACTIVE_CONST : BindingTypes.SETUP_CONST
                } else if (isConst) {
                    if (
                        isCallOf(init, m => m === userImportAliases['ref'] || m === userImportAliases['computed'] || m === userImportAliases['shallowRef'] || m === userImportAliases['customRef'] || m === userImportAliases['toRef'])
                    ) {
                        bindingType = BindingTypes.SETUP_REF
                    } else {
                        bindingType = BindingTypes.SETUP_MAYBE_REF
                    }
                } else {
                    bindingType = BindingTypes.SETUP_LET
                }
                registerBinding(bindings, id, bindingType)
            } else {
                if (isCallOf(init, DEFINE_PROPS) && isPropsDestructureEnabled) {
                    continue
                }
                if (id.type === 'ObjectPattern') {
                    walkObjectPattern(id, bindings, isConst, isConstMacroCall)
                } else if (id.type === 'ArrayPattern') {
                    walkArrayPattern(id, bindings, isConst, isConstMacroCall)
                }
            }
        }
    } else if (node.type === 'TSEnumDeclaration') {
        isAllLiteral = node.members.every(member => !member.initializer || isStaticNode(member.initializer))
        bindings[node.id!.name] = isAllLiteral ? BindingTypes.LITERAL_CONST : BindingTypes.SETUP_CONST
    } else if (
        node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration'
    ) {
        bindings[node.id!.name] = BindingTypes.SETUP_CONST
    }

    return isAllLiteral
}

function walkObjectPattern(node: ObjectPattern, bindings: Record<string, BindingTypes>, isConst: boolean, isDefineCall = false) {
    for (const p of node.properties) {
        if (p.type === 'ObjectProperty') {
            if (p.key.type === 'Identifier' && p.key === p.value) {
                const type = isDefineCall ? BindingTypes.SETUP_CONST : isConst ? BindingTypes.SETUP_MAYBE_REF : BindingTypes.SETUP_LET
                registerBinding(bindings, p.key, type)
            } else {
                walkPattern(p.value, bindings, isConst, isDefineCall)
            }
        } else {
            const type = isConst ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_LET
            registerBinding(bindings, p.argument as Identifier, type)
        }
    }
}

function walkArrayPattern(node: ArrayPattern, bindings: Record<string, BindingTypes>, isConst: boolean, isDefineCall = false) {
    for (const e of node.elements) {
        e && walkPattern(e, bindings, isConst, isDefineCall)
    }
}

function walkPattern(node: Node, bindings: Record<string, BindingTypes>, isConst: boolean, isDefineCall = false) {
    if (node.type === 'Identifier') {
        const type = isDefineCall ? BindingTypes.SETUP_CONST : isConst ? BindingTypes.SETUP_MAYBE_REF : BindingTypes.SETUP_LET
        registerBinding(bindings, node, type)
    } else if (node.type === 'RestElement') {
        const type = isConst ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_LET
        registerBinding(bindings, node.argument as Identifier, type)
    } else if (node.type === 'ObjectPattern') {
        walkObjectPattern(node, bindings, isConst)
    } else if (node.type === 'ArrayPattern') {
        walkArrayPattern(node, bindings, isConst)
    } else if (node.type === 'AssignmentPattern') {
        if (node.left.type === 'Identifier') {
            const type = isDefineCall ? BindingTypes.SETUP_CONST : isConst ? BindingTypes.SETUP_MAYBE_REF : BindingTypes.SETUP_LET
            registerBinding(bindings, node.left, type)
        } else {
            walkPattern(node.left, bindings, isConst)
        }
    }
}

function canNeverBeRef(node: Node, userReactiveImport?: string): boolean {
    if (isCallOf(node, userReactiveImport)) {
        return true
    }
    switch (node.type) {
        case 'UnaryExpression':
        case 'BinaryExpression':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'UpdateExpression':
        case 'ClassExpression':
        case 'TaggedTemplateExpression':
            return true
        case 'SequenceExpression':
            return canNeverBeRef(node.expressions[node.expressions.length - 1], userReactiveImport)
        default:
            if (isLiteralNode(node)) {
                return true
            }
            return false
    }
}

function isStaticNode(node: Node): boolean {
    node = unwrapTSNode(node)

    switch (node.type) {
        case 'UnaryExpression':
            return isStaticNode(node.argument)

        case 'LogicalExpression': // 1 > 2
        case 'BinaryExpression': // 1 + 2
            return isStaticNode(node.left) && isStaticNode(node.right)

        case 'ConditionalExpression': {
            // 1 ? 2 : 3
            return (isStaticNode(node.test) && isStaticNode(node.consequent) && isStaticNode(node.alternate))
        }

        case 'SequenceExpression': // (1, 2)
        case 'TemplateLiteral':
            return node.expressions.every(expr => isStaticNode(expr))

        case 'ParenthesizedExpression': // (1)
            return isStaticNode(node.expression)

        case 'StringLiteral':
        case 'NumericLiteral':
        case 'BooleanLiteral':
        case 'NullLiteral':
        case 'BigIntLiteral':
            return true
    }
    return false
}

export function mergeSourceMaps(scriptMap: RawSourceMap, templateMap: RawSourceMap, templateLineOffset: number): RawSourceMap {
    const generator = new SourceMapGenerator()
    const addMapping = (map: RawSourceMap, lineOffset = 0) => {
        const consumer = new SourceMapConsumer(map);

        (consumer as any).sources.forEach((sourceFile: string) => {
            (generator as any)._sources.add(sourceFile)

            const sourceContent = consumer.sourceContentFor(sourceFile)
            if (sourceContent != null) generator.setSourceContent(sourceFile, sourceContent)
        })

        consumer.eachMapping(m => {
            if (m.originalLine == null) return

            generator.addMapping({
                generated: {
                    line: m.generatedLine + lineOffset,
                    column: m.generatedColumn,
                },
                original: {
                    line: m.originalLine,
                    column: m.originalColumn!,
                },
                source: m.source,
                name: m.name,
            })
        })
    }

    addMapping(scriptMap)
    addMapping(templateMap, templateLineOffset);

    (generator as any)._sourceRoot = scriptMap.sourceRoot;
    (generator as any)._file = scriptMap.file

    return (generator as any).toJSON()
}
