import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

test('AST 格式修复保留注释、字符串与必要分号，拆分语句且重复执行无变化', () => {
    const directory = mkdtempSync(resolve('tmp-refs/style-'))
    const file = join(directory, '样例.ts')
    const source = [
        'import type {',
        '    A,',
        '    B,',
        '} from "types"; import { call } from "api";',
        '/** 中文说明 */',
        'export const value = call(',
        '    1,',
        '    2,',
        ');',
        'const fixture = "import { A } from \'x\'; import { B } from \'y\'";',
        'const regex = /a; import\\s+b/;',
        'function run() { call(); call(); }',
        'const boundary = call();',
        '(call)();',
        '// 原有注释',
        'const template = `首行\n第二行`;',
    ].join('\n')

    try {
        writeFileSync(file, source)
        const args = ['--import', 'tsx', 'scripts/format-code.ts', '--write', file]
        execFileSync(process.execPath, args, { stdio: 'pipe' })
        const result = readFileSync(file, 'utf8')
        assert.match(result, /import type \{ A, B \} from "types"\nimport \{ call \} from "api"/)
        assert.match(result, /export const value = call\(1, 2\)/)
        assert.equal(result.match(/\/\*\* 中文说明 \*\//g)?.length, 1)
        assert.match(result, /function run\(\) \{\n    call\(\)\n    call\(\)\n\}/)
        assert.ok(result.includes('const boundary = call();\n(call)()'))
        assert.ok(result.includes('"import { A } from \'x\'; import { B } from \'y\'"'))
        assert.ok(result.includes('/a; import\\s+b/'))
        assert.ok(result.includes('// 原有注释\nconst template = `首行\n第二行`'))
        execFileSync(process.execPath, args, { stdio: 'pipe' })
        assert.equal(readFileSync(file, 'utf8'), result)
        execFileSync(process.execPath, ['--import', 'tsx', 'scripts/format-code.ts', file], { stdio: 'pipe' })
    } finally {
        rmSync(directory, { recursive: true })
    }
})
