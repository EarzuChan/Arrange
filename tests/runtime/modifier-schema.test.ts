import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { modifierSchema } from '@arrange/shared'
import { assertModifierSchema } from '../../scripts/modifier-schema.ts'

test('原生修饰白名单与修饰 schema 一致', () => {
    assert.doesNotThrow(assertModifierSchema)
})

test('JS 降解产出的修饰种类都在 schema 中声明', () => {
    const root = new URL('../../packages/framework/src/', import.meta.url)
    const types = new Set<string>()
    for (const file of readdirSync(root).filter(name => name.endsWith('.ts'))) {
        const source = readFileSync(new URL(file, root), 'utf8')
        for (const match of source.matchAll(/#(?:add|interaction)\((?:[^,()]*,\s*)?['"]([a-zA-Z]+)['"]/g)) types.add(match[1])
    }
    assert.ok(types.size > 30, '没有扫描到修饰种类')
    for (const type of types) assert.ok(Object.hasOwn(modifierSchema, type), `修饰 ${type} 未在 schema 中声明`)
})

test('schema 的回调字段都是声明过的字段', () => {
    for (const [type, entry] of Object.entries(modifierSchema))
        for (const field of Object.keys(entry.events ?? {})) assert.ok(entry.fields.includes(field), `${type}.${field} 不在字段表中`)
})
