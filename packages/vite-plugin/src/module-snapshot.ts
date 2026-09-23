import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { walk } from 'estree-walker'
import MagicString from 'magic-string'
import type { RawSourceMap } from 'source-map-js'
import { composeSourceMap } from './source-map.ts'
import { transformWithOxc, type ViteDevServer } from 'vite'

export const MODULE_SNAPSHOT_PATH = '/@arrange/modules'
const CLIENT_PATH = '/@vite/client'
const BOOT_PATH = '/@arrange/entry'

export interface ModuleSource {
    url: string
    source: string
    map?: unknown
}

export interface ModuleSnapshot {
    entry: string
    modules: ModuleSource[]
}

function hotRuntimePath(): string {
    return `/@fs/${fileURLToPath(new URL(import.meta.resolve('@arrange/framework/internal').replace(/internal\.ts$/, 'hotRuntime.ts'))).replaceAll('\\', '/')}`
}

function moduleUrl(specifier: string, importer: string): string {
    if (!specifier.startsWith('/') && !specifier.startsWith('.')) throw new Error(`live ESM 存在未解析的模块：${specifier}（${importer}）`)
    const url = new URL(specifier, `http://arrange${importer}`)
    return url.pathname + url.search
}

function imports(source: string, importer: string, map?: RawSourceMap | null, rewriteRelativeImports = false): { urls: string[]; code: string; map?: RawSourceMap | null } {
    const urls = new Set<string>()
    const output = new MagicString(source)
    let dynamic = false
    const ast = parse(source, { sourceType: 'module', createImportExpressions: true })
    const identifiers = new Set<string>()
    walk(ast as any, { enter(node: any) { if (node.type === 'Identifier') identifiers.add(node.name) } })
    let importHelper = '__arrangeImport'
    while (identifiers.has(importHelper)) importHelper += '_'
    walk(ast as any, {
        enter(node: any) {
            if (node.type === 'ImportExpression') {
                dynamic = true
                output.overwrite(node.start, node.source.start, `${importHelper}(`)
                output.overwrite(node.source.end, node.end, `, ${JSON.stringify(importer)})`)
                return
            }
            const literal = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' ? node.source : undefined
            if (literal?.type === 'StringLiteral') {
                const resolved = moduleUrl(literal.value, importer)
                urls.add(resolved)
                if (rewriteRelativeImports && literal.value.startsWith('.')) output.overwrite(literal.start, literal.end, JSON.stringify(resolved))
            }
        },
    })
    if (dynamic) {
        urls.add(CLIENT_PATH)
        output.prepend(`import { importLiveModule as ${importHelper} } from ${JSON.stringify(CLIENT_PATH)}\n`)
    }
    return { urls: [...urls], code: output.toString(), map: dynamic ? composeSourceMap(output.generateMap({ source: importer, hires: true, includeContent: true }) as unknown as RawSourceMap, map) : map }
}

// 模块仍保持原始 ESM 边界；这里只收集 Vite 已转换的源码，不执行 bundler
export async function createModuleSnapshot(server: ViteDevServer, entry: string, roots?: string[]): Promise<ModuleSnapshot> {
    const modules = new Map<string, ModuleSource>()
    const pending = roots?.length ? [...roots] : [BOOT_PATH]
    while (pending.length) {
        const url = pending.shift()!
        if (modules.has(url)) continue
        let result: { code: string; map?: unknown } | null
        if (url === BOOT_PATH) result = { code: `import '/@vite/env'\nimport { createHotContext } from ${JSON.stringify(CLIENT_PATH)}\ncreateHotContext(${JSON.stringify(BOOT_PATH)})\nimport ${JSON.stringify('/' + entry.replace(/^\//, ''))}` }
        else if (url === CLIENT_PATH) {
            const filePath = hotRuntimePath().replace(/^\/@fs\//, '')
            result = await transformWithOxc(await readFile(filePath, 'utf8'), hotRuntimePath(), { lang: 'ts', target: 'es2022' })
        }
        else {
            if (/\.(css|less|sass|scss|styl)(?:\?|$)/.test(url)) throw new Error(`Arrange live 不支持 CSS 模块：${url}`)
            result = await server.transformRequest(url)
        }
        if (!result) throw new Error(`Vite 未返回模块：${url}`)
        const importer = url === CLIENT_PATH ? hotRuntimePath() : url
        const transformed = imports(result.code, importer, result.map as RawSourceMap | undefined, url === CLIENT_PATH)
        modules.set(url, { url, source: transformed.code, map: transformed.map })
        pending.push(...transformed.urls)
    }
    return { entry: BOOT_PATH, modules: [...modules.values()] }
}
