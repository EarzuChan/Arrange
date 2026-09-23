import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

type Edit = { start: number, end: number, text: string }

const root = resolve(import.meta.dirname, '..')
const write = process.argv.includes('--write')
const requested = process.argv.slice(2).filter(argument => argument !== '--write')
const files = requested.length ? requested : execFileSync('rg', ['--files', 'packages', 'cli', 'scripts', 'tests', 'demo', 'types', '-g', '*.ts', '-g', '*.mts', '-g', '*.cts', '-g', '*.js', '-g', '*.sfa'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/)

function parse(source: string, filename: string) {
    return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS)
}

function apply(source: string, edits: Edit[]): string {
    let boundary = source.length + 1

    for (const edit of edits.sort((left, right) => right.start - left.start || right.end - left.end)) {
        if (edit.end > boundary) throw new Error('格式修改范围重叠')

        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
        boundary = edit.start
    }

    return source
}

// 比较语法节点和叶子原文，确保换行与分号调整没有改变 ASI、字面量或表达式含义
function fingerprint(node: ts.Node, file: ts.SourceFile): string {
    const parts: (string | number)[] = []
    const visit = (current: ts.Node) => {
        if (ts.isEmptyStatement(current) && (ts.isBlock(current.parent) || ts.isSourceFile(current.parent))) return

        parts.push(current.kind)
        let children = 0
        ts.forEachChild(current, child => {
            children++
            visit(child)
        })
        if (!children && current.kind <= ts.SyntaxKind.LastToken) parts.push(current.getText(file))
        parts.push(-1)
    }

    visit(node)

    return JSON.stringify(parts)
}

function formatScriptOnce(source: string, filename: string): string {
    const original = parse(source, filename)
    const expected = fingerprint(original, original)
    const newline = source.includes('\r\n') ? '\r\n' : '\n'

    const indentation = (position: number) => source.slice(source.lastIndexOf('\n', position - 1) + 1, position).match(/^[\t ]*/)?.[0] ?? ''
    const split: Edit[] = []
    const visitStatements = (node: ts.Node) => {
        if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
            const statements = node.statements
            const indent = ts.isSourceFile(node) ? '' : indentation(node.getStart(original)) + '    '

            for (let index = 1; index < statements.length; index++) {
                const previous = statements[index - 1]
                const next = statements[index]
                const gap = source.slice(previous.end, next.getStart(original))
                if (ts.isEmptyStatement(previous)) continue
                if (/^[\t ]*$/.test(gap)) split.push({ start: previous.end, end: next.getStart(original), text: newline + indent })
            }

            if (ts.isBlock(node) && statements.length > 1) {
                const first = statements[0].getStart(original)
                const last = statements[statements.length - 1].end
                if (/^[\t ]*$/.test(source.slice(node.getStart(original) + 1, first))) split.push({ start: node.getStart(original) + 1, end: first, text: newline + indent })
                if (/^[\t ]*$/.test(source.slice(last, node.end - 1))) split.push({ start: last, end: node.end - 1, text: newline + indentation(node.getStart(original)) })
            }
        }

        ts.forEachChild(node, visitStatements)
    }

    visitStatements(original)
    source = apply(source, split)
    let file = parse(source, filename)
    const edits: Edit[] = []

    const compact = (node: ts.Node): string | undefined => {
        const tokens: ts.Node[] = []
        const collect = (child: ts.Node) => {
            if (child.end <= node.getStart(file) || child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode) return

            const children = child.getChildren(file)
            if (!children.length) tokens.push(child)
            else children.forEach(collect)
        }

        collect(node)
        let result = ''
        let end = node.getStart(file)

        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index]
            const gap = source.slice(end, token.getStart(file))
            if (/\S/.test(gap)) return

            const previous = tokens[index - 1]?.kind
            const next = tokens[index + 1]?.kind
            const closing = token.kind === ts.SyntaxKind.CloseParenToken || token.kind === ts.SyntaxKind.CloseBracketToken
            const opening = previous === ts.SyntaxKind.OpenParenToken || previous === ts.SyntaxKind.OpenBracketToken
            const member = token.kind === ts.SyntaxKind.DotToken || token.kind === ts.SyntaxKind.QuestionDotToken || previous === ts.SyntaxKind.DotToken || previous === ts.SyntaxKind.QuestionDotToken
            end = token.end
            if (token.kind === ts.SyntaxKind.CommaToken && (next === ts.SyntaxKind.CloseParenToken || next === ts.SyntaxKind.CloseBraceToken)) continue

            result += (gap && !opening && !closing && !member ? ' ' : '') + token.getText(file)
        }

        return result
    }

    const simple = (node: ts.Node): boolean => {
        if (ts.isBlock(node) || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isTypeLiteralNode(node)) return false
        let result = true
        ts.forEachChild(node, child => { if (!simple(child)) result = false })

        return result
    }

    const visit = (node: ts.Node) => {
        const declaration = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        const expression = ts.isVariableStatement(node) || ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isExpressionStatement(node) || ts.isCallExpression(node) || ts.isBinaryExpression(node) || ts.isConditionalExpression(node) || ts.isTypeAliasDeclaration(node)

        if (declaration || expression && simple(node)) {
            const replacement = compact(node)
            if (replacement !== undefined && replacement !== node.getText(file)) {
                edits.push({ start: node.getStart(file), end: node.end, text: replacement })
                return
            }
        }

        ts.forEachChild(node, visit)
    }

    visit(file)
    source = apply(source, edits)
    file = parse(source, filename)
    const parameters: Edit[] = []
    const joinParameters = (node: ts.Node) => {
        if (ts.isFunctionLike(node) && node.parameters.every(simple)) {
            const children = node.getChildren(file)
            const open = children.find(child => child.kind === ts.SyntaxKind.OpenParenToken)
            const close = children.find(child => child.kind === ts.SyntaxKind.CloseParenToken)
            const values = node.parameters.map(compact)

            if (open && close && values.every(value => value !== undefined)) {
                const body = source.slice(open.end, close.getStart(file))
                const replacement = values.join(', ')
                // 参数间的注释不属于参数节点，必须单独保留
                if (!body.includes('//') && !body.includes('/*') && body !== replacement) {
                    parameters.push({ start: open.end, end: close.getStart(file), text: replacement })
                    ts.forEachChild(node, child => { if (!node.parameters.includes(child as ts.ParameterDeclaration)) joinParameters(child) })
                    return
                }
            }
        }

        ts.forEachChild(node, joinParameters)
    }

    joinParameters(file)
    source = apply(source, parameters)
    file = parse(source, filename)
    const semicolons: Edit[] = []
    const removeSemicolons = (node: ts.Node) => {
        if (ts.isVariableStatement(node) || ts.isExpressionStatement(node) || ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
            const last = node.getLastToken(file)
            if (last?.kind === ts.SyntaxKind.SemicolonToken) {
                const next = source.slice(node.end).trimStart()
                const gap = source.slice(node.end, node.end + source.slice(node.end).search(/\S|$/))
                const boundary = !next || next.startsWith('}') || /[\r\n]/.test(gap)
                if (boundary && !/^[([`/+\-<]/.test(next)) semicolons.push({ start: last.getStart(file), end: last.end, text: '' })
                else {
                    const start = node.getStart(file)
                    const end = start + source.slice(start, last.getStart(file)).trimEnd().length
                    if (end < last.getStart(file)) semicolons.push({ start: end, end: last.end, text: ';' })
                }
            }
        }

        ts.forEachChild(node, removeSemicolons)
    }

    removeSemicolons(file)
    source = apply(source, semicolons)
    file = parse(source, filename)
    const emptyStatements: ts.EmptyStatement[] = []
    const collectEmpty = (node: ts.Node) => {
        if (ts.isEmptyStatement(node) && (ts.isBlock(node.parent) || ts.isSourceFile(node.parent))) emptyStatements.push(node)
        ts.forEachChild(node, collectEmpty)
    }

    collectEmpty(file)

    // 防御性前置分号只有在删除后仍得到同一语法树时才可省略
    for (const empty of emptyStatements.reverse()) {
        const next = source.slice(empty.end).trimStart()
        if (/^['"]/.test(next)) continue

        const candidate = source.slice(0, empty.getStart(file)) + source.slice(empty.end)
        const parsed = parse(candidate, filename)
        if (fingerprint(parsed, parsed) === expected) source = candidate
    }

    const result = parse(source, filename)
    if (fingerprint(result, result) !== expected) throw new Error(`格式调整改变语法树，拒绝写入：${filename}`)

    return source
}

function formatScriptPass(source: string, filename: string): string {
    const service = ts.createLanguageService({
        getCompilationSettings: () => ({ allowJs: true }),
        getScriptFileNames: () => [filename],
        getScriptVersion: () => '0',
        getScriptSnapshot: name => name === filename ? ts.ScriptSnapshot.fromString(source) : undefined,
        getCurrentDirectory: () => root,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
    })

    try {
        const settings: ts.FormatCodeSettings = { indentSize: 4, tabSize: 4, convertTabsToSpaces: true, newLineCharacter: source.includes('\r\n') ? '\r\n' : '\n', insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true, insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true, insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true, insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false, placeOpenBraceOnNewLineForFunctions: false, placeOpenBraceOnNewLineForControlBlocks: false, semicolons: ts.SemicolonPreference.Ignore }
        const original = parse(source, filename)
        source = apply(source, service.getFormattingEditsForDocument(filename, settings).map(edit => ({ start: edit.span.start, end: edit.span.start + edit.span.length, text: edit.newText })))
        const formatted = parse(source, filename)
        if (fingerprint(original, original) !== fingerprint(formatted, formatted)) throw new Error(`缩进调整改变语法树，拒绝写入：${filename}`)
    } finally {
        service.dispose()
    }

    return formatScriptOnce(source, filename)
}

function formatScript(source: string, filename: string): string {
    for (let iteration = 0; iteration < 8; iteration++) {
        const next = formatScriptPass(source, filename)
        if (next === source) return source

        source = next
    }

    throw new Error(`格式调整未收敛：${filename}`)
}

// SFA 只处理实际脚本区域，不把模板、测试字符串或生成代码当作宿主代码改写
function formatFile(source: string, filename: string): string {
    if (!filename.endsWith('.sfa')) return formatScript(source, filename)

    return source.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, script, close) => open + formatScript(script, filename + '.ts') + close)
}

const changes: { file: string, source: string }[] = []

for (const filename of files) {
    const file = resolve(root, filename)
    const original = readFileSync(file, 'utf8')
    const source = formatFile(original, filename)
    if (source !== original) changes.push({ file, source })
}

// 全部文件通过语义检查后再写入，任何失败都不会产生半套格式修改
if (write) {
    for (const { file, source } of changes) writeFileSync(file, source)
} else {
    for (const { file } of changes) console.error('[ArrangeFormat]', `格式待修正：${file}`)
    if (changes.length) process.exitCode = 1
}

console.log('[ArrangeFormat]', `${write ? '已修正' : '已检查'} ${files.length} 个文件，${changes.length} 个文件${write ? '已更新' : '需要调整'}`)

