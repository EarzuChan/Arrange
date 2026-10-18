import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../src/', import.meta.url))
async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : Promise.resolve(entry.name.endsWith('.ts') ? [resolve(directory, entry.name)] : [])))).flat()
}

test('三层与工具依赖方向可执行约束，功能与终端不得直接互相使用', async () => {
    const allowed: Record<string, readonly string[]> = { terminal: ['terminal', 'util', 'CliMetadata.ts'], feature: ['feature', 'util', 'CliMetadata.ts'], business: ['business', 'feature', 'terminal', 'util', 'CliMetadata.ts'], util: ['util', 'CliMetadata.ts'] }
    const violations: string[] = []
    for (const file of await files(root)) {
        const name = relative(root, file).split(sep).join('/')
        const layer = name.split('/')[0]!
        if (!allowed[layer]) continue
        const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
        const inspect = (node: ts.Node): void => {
            const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
            if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
                const dependency = relative(root, resolve(dirname(file), specifier.text)).split(sep).join('/').split('/')[0]!
                if (!allowed[layer]!.includes(dependency)) violations.push(name + ' → ' + specifier.text)
            }
            ts.forEachChild(node, inspect)
        }
        inspect(source)
    }
    assert.deepEqual(violations, [], '依赖必须遵守 terminal、business、feature、util 的单向边界')
    const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    assert.deepEqual(directories, ['business', 'feature', 'terminal', 'util'])
})

test('生产源码只有终端驱动接管系统流，业务不写 ANSI 或监听终端事件', async () => {
    const violations: string[] = []
    for (const file of await files(root)) {
        const name = relative(root, file).split(sep).join('/')
        const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
        const inspect = (node: ts.Node): void => {
            if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'process' && ['stdin', 'stdout', 'stderr'].includes(node.name.text) && name !== 'terminal/TerminalDriver.ts' && name !== 'Entry.ts') violations.push(name + ': ' + node.getText(source))
            if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'stdio' && ts.isStringLiteral(node.initializer) && node.initializer.text === 'inherit') violations.push(name + ': stdio inherit')
            if (name.startsWith('business/') && ts.isStringLiteralLike(node) && node.text.includes('\x1b')) violations.push(name + ': 业务包含终端控制字节')
            if (name.startsWith('business/') && ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'process' && node.name.text === 'exitCode') violations.push(name + ': 业务直接使用宿主退出码')
            ts.forEachChild(node, inspect)
        }
        inspect(source)
    }
    assert.deepEqual(violations, [])
})
