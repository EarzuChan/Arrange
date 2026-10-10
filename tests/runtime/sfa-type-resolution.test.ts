import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'

// 只通过 exports 暴露子路径的包，与 @arrange/framework 的发布形态一致：Node10 解析不读 exports，Bundler 解析可以
function createProject(tsconfig?: object): { directory: string, compile: (source: string) => string } {
    // 建在系统临时目录：仓库内的目录会向上找到仓库根的 tsconfig，就不是“没有 tsconfig”了
    const directory = mkdtempSync(join(tmpdir(), 'arrange-sfa-resolution-'))
    const pkg = join(directory, 'node_modules', 'exports-only')
    mkdirSync(pkg, { recursive: true })
    // 子路径 ./types 与文件位置不同名（./src/definitions.ts）：不读 exports 的解析按路径找 exports-only/types 只能失败
    mkdirSync(join(pkg, 'src'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'exports-only', version: '1.0.0', type: 'module', exports: { './types': './src/definitions.ts' } }))
    writeFileSync(join(pkg, 'src', 'definitions.ts'), 'export interface Tone { value: number }\n')
    if (tsconfig) writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfig))
    return { directory, compile: source => compileArrangeSfa(source, join(directory, 'View.sfa')).code }
}

const sfa = (importSource: string) => `<template>
    <Text :text="label" />
</template>

<script>
import { computed } from '@arrange/framework'
import type { Tone } from '${importSource}'

const props = defineProps<{ tone: Tone }>()
const label = computed(() => String(props.tone.value))
</script>`

for (const [label, tsconfig] of [
    ['没有 tsconfig.json', undefined],
    ['tsconfig 把模块解析设为 Node10', { compilerOptions: { moduleResolution: 'node10', module: 'commonjs' } }],
    ['tsconfig 使用 Bundler', { compilerOptions: { moduleResolution: 'bundler', module: 'esnext' } }],
    ['tsconfig 为空对象', {}],
] as const) {
    test(`SFA 类型解析在${label}时仍遵循包的 exports`, () => {
        const project = createProject(tsconfig)
        try {
            const code = project.compile(sfa('exports-only/types'))
            assert.match(code, /tone/)
        } finally {
            rmSync(project.directory, { recursive: true })
        }
    })
}

test('SFA 类型解析保留 tsconfig 的 paths 别名', () => {
    const project = createProject({ compilerOptions: { moduleResolution: 'node10', baseUrl: '.', paths: { '@local/*': ['./local/*'] } } })
    try {
        mkdirSync(join(project.directory, 'local'), { recursive: true })
        writeFileSync(join(project.directory, 'local', 'shapes.ts'), 'export interface Tone { value: number }\n')
        assert.match(project.compile(sfa('@local/shapes')), /tone/)
    } finally {
        rmSync(project.directory, { recursive: true })
    }
})

test('无法解析类型导入时报错说明解析规则与 tsconfig 状态', () => {
    const missing = createProject()
    try {
        assert.throws(() => missing.compile(sfa('not-installed/types')), error => {
            const message = (error as Error).message
            assert.match(message, /无法解析类型导入 "not-installed\/types"/)
            assert.match(message, /Bundler 模块解析/)
            assert.match(message, /tsconfig\.json 未找到，使用内置默认值/)
            assert.match(message, /exports 或 types/)
            return true
        })
    } finally {
        rmSync(missing.directory, { recursive: true })
    }
    const configured = createProject({ compilerOptions: {} })
    try {
        assert.throws(() => configured.compile(sfa('not-installed/types')), error => /tsconfig\.json 使用 .*tsconfig\.json/.test((error as Error).message))
        assert.throws(() => configured.compile(sfa('./missing')), error => /请确认相对路径与扩展名正确/.test((error as Error).message))
    } finally {
        rmSync(configured.directory, { recursive: true })
    }
})
