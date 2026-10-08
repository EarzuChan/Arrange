import * as core from '@arrange/framework'
import * as foundation from '@arrange/framework/foundation'
import * as ui from '@arrange/framework/ui'
import * as animation from '@arrange/framework/animation'
import * as internal from '@arrange/framework/internal'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'

const modules: Record<string, unknown> = { '@arrange/framework': core, '@arrange/framework/foundation': foundation, '@arrange/framework/ui': ui, '@arrange/framework/animation': animation, '@arrange/framework/internal': internal }

export function requireSfaModule(name: string): unknown {
    if (!Object.hasOwn(modules, name)) throw new Error(`测试未提供 SFA 依赖：${name}`)

    return modules[name]
}

// 只执行正式编译产物，不在测试内复制模板、布局或重排实现
export function evaluateSfa(source: string, imports: Record<string, unknown> = {}, filename = '测试.sfa'): core.ArrangableDefinition {
    const { code } = compileArrangeSfa(source, filename)
    const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { default?: core.ArrangableDefinition } = {}
    new Function('require', 'exports', output)((name: string) => Object.hasOwn(imports, name) ? imports[name] : requireSfaModule(name), exports)
    assert.ok(exports.default, 'SFA 必须生成正式 Arrangable 定义')
    return exports.default
}
