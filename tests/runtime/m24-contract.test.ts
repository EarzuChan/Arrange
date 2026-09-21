import { requireSfaModule } from './sfaModules.ts'
import * as internal from '../../packages/framework/src/internal.ts'
import * as foundation from '../../packages/framework/src/foundation.ts'
import * as ui from '../../packages/framework/src/ui.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { checkSfaProject } from '../../packages/vite-plugin/src/typecheck.ts'
import { compile } from '../../packages/compiler/src/template/index.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import * as runtime from '../../packages/framework/src/index.ts'
import { recordingNative } from './recordingNative.ts'

function evaluateSfa(source: string, imports: Record<string, unknown> = {}) {
    const { code } = compileArrangeSfa(source, '契约.sfa')
    const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { default?: runtime.ArrangableDefinition } = {}
    new Function('require', 'exports', output)((name: string) => Object.hasOwn(imports, name) ? imports[name] : requireSfaModule(name), exports)
    return exports.default!
}

test('模板内容和指令只接受正式语法，空白不改变结构', () => {
    for (const source of ['<Row>正文</Row>', '<Text>{{ title }}</Text>', '<Xxx :value />', '<Xxx @submit="go" />', '<Input a-model="value" />', '<Box ref="box" />', '<Box a-pre />', '<Box a-once />', '<Box a-memo="[]" />', '<keep-alive />', '<Xxx :someValue="a" :some-value="b" />']) assert.throws(() => compile(source), SyntaxError)
    const options = { mode: 'module' as const, prefixIdentifiers: true }
    assert.equal(compile('<Row><Spacer/> <Spacer/></Row>', options).code.replace(/模板.sfa:\d+:\d+/g, '位置'), compile('<Row>\n    <Spacer/>\n    <Spacer/>\n</Row>', options).code.replace(/模板.sfa:\d+:\d+/g, '位置'))
    assert.match(compile('<Xxx enabled />', options).code, /"enabled": \(\) => true/)
    assert.match(compile('<Xxx enabled="" />', options).code, /"enabled": \(\) => ""/)

    const legacyDirective = evaluateSfa('<template><Box v-if="false" /></template>')
    assert.throws(() => runtime.createApp(legacyDirective).mount(recordingNative().target), /未声明参数：vIf/)
})

test('SFA 只接受无属性的 TS setup，原样 Ref 与普通绑定明确分开', () => {
    for (const attributes of ['setup', 'lang="ts"', 'lang="js"']) assert.throws(() => compileArrangeSfa(`<script ${attributes}>const x = 1</script>`, '失败.sfa'), /不接受属性/)
    assert.throws(() => compileArrangeSfa('<script>const a = 1</script><script>const b = 2</script>', '失败.sfa'))
    const result = compileArrangeSfa("<template><Editor :raw=\"<state>\" :plain=\"state\" /></template><script>import { ref } from '@arrange/framework'\n const state = ref(1)</script>", '状态.sfa')
    assert.match(result.code, /\(state\)/)
    assert.match(result.code, /state.value/)
    const definition = evaluateSfa("<script>import type { Ref } from '@arrange/framework'\n defineProps<{ state: Ref<number>; count: number; enabled?: boolean }>()</script>")
    assert.deepEqual((definition as { props: unknown }).props, { state: { type: Object, required: true, refKind: 'writable' }, count: { type: Number, required: true }, enabled: { type: Boolean, required: false } })
})

test('参数提取类型通过正式入口解析别名和导入类型，默认值只补齐内部参数', () => {
    const declaration = 'type Options = { title: { type: StringConstructor; required: true }; count: { type: NumberConstructor; default: 1 }; flag: BooleanConstructor }'
    for (const publicProps of [false, true]) {
        const helper = publicProps ? 'ExtractPublicPropTypes' : 'ExtractPropTypes'
        for (const inline of [false, true]) {
            const imported = inline ? '' : `import type { ${helper} as PropsFrom } from '@arrange/framework'\n`
            const expression = inline ? `import('@arrange/framework').${helper}<Options>` : 'PropsFrom<Options>'
            const definition = evaluateSfa(`<script>${imported}${declaration}\ndefineProps<${expression}>()</script>`)
            const props = definition.props as Record<string, { type: unknown; required: boolean }>
            assert.equal(props.title.type, String)
            assert.equal(props.title.required, true)
            assert.equal(props.count.type, Number)
            assert.equal(props.count.required, !publicProps)
            assert.equal(props.flag.type, Boolean)
            assert.equal(props.flag.required, false)
        }
    }

    assert.throws(() => evaluateSfa('<script>interface Props extends /* @vue-ignore */ Missing {}\ndefineProps<Props>()</script>'), /无法解析继承的参数类型/)
})

test('参数对象按同一 camelize 规则拒绝重复，不合并回调', () => {
    assert.throws(() => internal.parameterInputs([['someValue', () => 1], ['some-value', () => 2]]), /重复参数/)
    assert.throws(() => internal.parameterInputs([['onSubmit', () => () => { }], ['onSubmit', () => () => { }]]), /重复参数/)
    assert.throws(() => internal.arrangeParameterName(undefined), /非空字符串/)
    assert.equal(internal.parameterInputs([['some-value', () => 1]]).someValue(), 1)
})

test('真实 SFA 命令行类型检查保留脚本和跨文件参数契约', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-typecheck-'))
    try {
        writeFileSync(join(directory, 'Editor.sfa'), "<template><Text :text=\"String(state.value)\" /></template><script>import type { Ref } from '@arrange/framework'\n\ndefineProps<{ state: Ref<number>; flag?: boolean }>()</script>")
        writeFileSync(join(directory, 'Good.sfa'), "<template><Editor :state=\"<state>\" /></template><script>import { ref } from '@arrange/framework'\n\nimport Editor from \"./Editor.sfa\"\n\nconst state = ref(1)</script>")
        assert.deepEqual(checkSfaProject(resolve('tsconfig.json'), [join(directory, 'Good.sfa')]), [])

        const invalidSource = "<template>\n    <Editor :state=\"state\" flag=\"false\" />\n    <Text :text=\"({ a: 1 })\" />\n</template>\n<script>\nimport { ref } from '@arrange/framework'\n\nimport Editor from \"./Editor.sfa\"\n\nconst state = ref(1)\nconst broken: number = \"错误\"\n</script>"
        writeFileSync(join(directory, 'Bad.sfa'), invalidSource)
        const diagnostics = checkSfaProject(resolve('tsconfig.json'), [join(directory, 'Bad.sfa')])
        assert.ok(diagnostics.some(item => item.line === 2 && /Ref/.test(item.message)), JSON.stringify(diagnostics))
        assert.ok(diagnostics.some(item => item.line === 2 && /boolean/.test(item.message)), JSON.stringify(diagnostics))
        assert.ok(diagnostics.some(item => item.line === 3 && /string/.test(item.message)), JSON.stringify(diagnostics))
        const brokenLine = invalidSource.split('\n').findIndex(line => line.includes('const broken:')) + 1
        assert.ok(diagnostics.some(item => item.line === brokenLine && item.column === 7 && /number/.test(item.message)), JSON.stringify(diagnostics))
    } finally {
        rmSync(directory, { recursive: true })
    }
})

test('内建 Arrangable 各自声明参数，不给 Spacer 和文本补充通用输入', () => {
    for (const [definition, props] of [[foundation.Spacer, { enabled: true }], [foundation.Text, { contentDescription: '误传' }], [foundation.Row, { role: '误传' }]] as const) {
        assert.throws(() => runtime.createApp(definition, props).mount(recordingNative().target), /未声明参数/)
    }
})

test('SFA 模板支持独占行与行末 // 彩蛋注释且不进入产物', () => {
    const source = `<template>
    // 独占行注释
    <Column> // 开始内容
        <Text text="标题" /> // 行末注释
        <Text :text="'http://example.test//'" />
    </Column>
</template>`
    const result = compileArrangeSfa(source, '注释.sfa')
    assert.doesNotMatch(result.code, /独占行注释|开始内容|行末注释/)
    assert.match(result.code, /http:\/\/example\.test\/\//)
    assert.equal((result.code.match(/_callArrangable\(/g) ?? []).length, 3)
})

test('对象参数类型检查保留字段类型、必需性与未声明字段', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-object-typecheck-'))
    try {
        writeFileSync(join(directory, 'Target.sfa'), '<script>defineProps<{ count: number }>()</script>')
        writeFileSync(join(directory, 'Good.sfa'), "<template><Target a-bind=\"values\" /></template><script>import Target from \"./Target.sfa\";\n const values = { count: 1 }</script>")
        assert.deepEqual(checkSfaProject(resolve('tsconfig.json'), [join(directory, 'Good.sfa')]), [])
        writeFileSync(join(directory, 'Bad.sfa'), "<template>\n<Target a-bind=\"wrong\" />\n<Target a-bind=\"missing\" />\n<Target a-bind=\"extra\" />\n</template><script>import Target from \"./Target.sfa\";\n const wrong = { count: \"错误\" }; const missing = {}; const extra = { count: 1, unknown: true }</script>")
        const diagnostics = checkSfaProject(resolve('tsconfig.json'), [join(directory, 'Bad.sfa')])
        for (const line of [2, 3, 4]) assert.ok(diagnostics.some(item => item.line === line), JSON.stringify(diagnostics))
    } finally {
        rmSync(directory, { recursive: true })
    }
})

test('声明位置计划保留列表闭包与默认时机，固定调用减少名称解析', async () => {
    const run = async (attributes: string) => {
        const rows = runtime.ref([{ id: '甲', value: 0 }, { id: '乙', value: 1 }])
        const Page = evaluateSfa(`<template><Text a-for="row in rows" :key="row.id" ${attributes} /></template><script>import { rows } from "harness"
</script>`, { harness: { rows } })
        const native = recordingNative()
        const app = runtime.createApp(Page)
        app.mount(native.target)
        const identities = native.textNodes().map(node => node.id)
        const before = internal.getArrangeExecutionStats()
        for (let index = 1; index <= 12; index++) {
            rows.value = [{ id: '乙', value: index + 1 }, { id: '甲', value: index }]
            await runtime.nextTick()
        }
        assert.deepEqual(native.textNodes(), [{ id: identities[1], text: '13' }, { id: identities[0], text: '12' }])
        const after = internal.getArrangeExecutionStats()
        app.unmount()
        return { names: after.parameterNameChecks - before.parameterNameChecks, positions: after.parameterPositionReads - before.parameterPositionReads }
    }
    const fixed = await run(':text="String(row.value)"')
    const dynamic = await run('a-bind="{ text: String(row.value) }"')
    assert.ok(fixed.names < dynamic.names, JSON.stringify({ fixed, dynamic }))
    assert.ok(fixed.positions > 0)
    console.log('列表固定声明位置与动态对象对比：' + JSON.stringify({ fixed, dynamic }))

    let defaults = 0
    let constants = 0
    const revision = runtime.ref(0)
    const Probe = internal.defineArrangable({
        props: {
            text: String, fallback: {
                default: () => {
                    defaults++
                    return {}
                }
            }
        }, setup: () => () => { }
    })
    const parameters = internal.prepareParameters(Probe, ['text'])
    assert.equal(defaults, 0)
    const app = runtime.createApp(internal.defineArrangable({
        setup: (_props, { call }) => () => {
            revision.value
            call(0, Probe, {
                text: () => {
                    constants++
                    return '固定'
                }
            }, {}, { parameters, constants: ['text'] })
        }
    }))
    app.mount(recordingNative().target)
    for (let index = 0; index < 4; index++) {
        revision.value++
        await runtime.nextTick()
    }
    assert.equal(defaults, 1)
    assert.equal(constants, 1)
    app.unmount()
})


test('手写结构不能返回文本或节点数组，也不能使用未声明定义', () => {
    for (const result of ['正文', []]) {
        const definition = internal.defineArrangable({ setup: () => (() => result) as () => void })
        assert.throws(() => runtime.createApp(definition).mount(recordingNative().target), /不能返回/)
    }
    assert.throws(() => runtime.createApp({ setup: () => () => { } } as unknown as runtime.ArrangableDefinition), /Arrangable 定义/)
})


test('SFA Slot 声明约束内容名称，多次调用拥有独立实例和结构订阅', async () => {
    const Consumer = evaluateSfa('<template><Slot /><Slot /></template>')
    const visible = runtime.ref(true)
    const label = runtime.ref('初始文字')
    let created = 0
    let disposed = 0
    let parentRuns = 0
    let contentRuns = 0
    const Probe = internal.defineArrangable({
        setup(_props, { call }) {
            const identity = ++created
            runtime.onUnmounted(() => { disposed++ })
            return () => call(0, foundation.Text, { text: () => `${identity}：${label.value}` })
        },
    })
    const native = recordingNative()
    const app = runtime.createApp(internal.defineArrangable({
        setup: (_props, { call }) => () => {
            parentRuns++
            call(0, Consumer, {}, {
                default: () => {
                    contentRuns++
                    if (visible.value) call(0, Probe, {})
                }
            })
        },
    }))
    app.mount(native.target)
    assert.equal(created, 2)
    assert.equal(parentRuns, 1)
    assert.equal(contentRuns, 2)
    assert.equal(native.textNodes().length, 2)

    label.value = '更新文字'
    await runtime.nextTick()
    assert.equal(contentRuns, 2)
    assert.equal(parentRuns, 1)
    assert.deepEqual(native.textNodes().map(node => node.text), ['1：更新文字', '2：更新文字'])

    visible.value = false
    await runtime.nextTick()
    assert.equal(contentRuns, 4)
    assert.equal(parentRuns, 1)
    assert.equal(disposed, 2)
    assert.equal(native.textNodes().length, 0)

    app.unmount()
    visible.value = true
    label.value = '卸载后的更新'
    await runtime.nextTick()
    assert.equal(contentRuns, 4)
    assert.equal(created, 2)

    assert.throws(() => runtime.createApp(internal.defineArrangable({ setup: (_props, { call }) => () => call(0, Consumer, {}, { header: () => { } }) })).mount(recordingNative().target), /未声明内容：header/)
    const Empty = evaluateSfa('<template></template>')
    assert.throws(() => runtime.createApp(internal.defineArrangable({ setup: (_props, { call }) => () => call(0, Empty, {}, { default: () => { } }) })).mount(recordingNative().target), /未声明内容：default/)
})


test('原样 Ref 标记保留泛型、比较与类型断言的 TS 边界', () => {
    const compileBinding = (expression: string) => compileArrangeSfa('<template><Editor :state="' + expression + '" /></template><script>const state = 1; const other = 2; const factory = &lt;T,&gt;(value: T) =&gt; value</script>'.replaceAll('&lt;', '<').replaceAll('&gt;', '>'), '边界.sfa').code
    assert.match(compileBinding('<state>'), /\(state\)/)
    assert.match(compileBinding('<factory<number>(state)>'), /factory<number>\(state\)/)
    assert.match(compileBinding('<state > other ? state : other>'), /state > other/)
    assert.doesNotThrow(() => compileBinding('state < other'))
    assert.doesNotThrow(() => compileBinding('<number>factory<number>'))
    assert.throws(() => compileBinding('<>'))
    assert.throws(() => compileBinding('<state><other>'))
})

test('原样 Ref 外层标记不会被比较、右移或泛型中的尖括号提前截断', () => {
    const firstRef = runtime.ref(1)
    const secondRef = runtime.ref(2)
    const cases: [string, ts.SyntaxKind, unknown][] = [
        ['<a > b ? firstRef : secondRef>', ts.SyntaxKind.ConditionalExpression, firstRef],
        ['<a > b>', ts.SyntaxKind.GreaterThanToken, true],
        ['<a >> b>', ts.SyntaxKind.GreaterThanGreaterThanToken, 1],
        ['<a < b>', ts.SyntaxKind.LessThanToken, false],
        ['<foo<T>()>', ts.SyntaxKind.CallExpression, firstRef],
    ]
    for (const [expression, kind, expected] of cases) {
        const { code } = compileArrangeSfa('<template><Editor :state="' + expression + "\" /></template><script>import { ref } from '@arrange/framework'\n const a = 4, b = 2; type T = number; const firstRef = ref(1), secondRef = ref(2); function foo<X>() { return firstRef }</script>", '尖括号边界.sfa')
        const ast = ts.createSourceFile('编译产物.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        let getter: ts.ArrowFunction | undefined
        const visit = (node: ts.Node) => {
            if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === 'state' && ts.isArrowFunction(node.initializer)) getter = node.initializer
            ts.forEachChild(node, visit)
        }
        visit(ast)
        assert.ok(getter, expression)
        let body = getter.body
        while (ts.isParenthesizedExpression(body)) body = body.expression
        assert.equal(ts.isBinaryExpression(body) ? body.operatorToken.kind : body.kind, kind, expression)

        // 执行真实编译产物中的参数 getter，检查运算结果与 Ref 身份
        const output = ts.transpileModule('const result = ' + getter.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
        const evaluate = new Function('a', 'b', 'firstRef', 'secondRef', 'foo', output + '\nreturn result()')
        assert.equal(evaluate(4, 2, firstRef, secondRef, () => firstRef), expected, expression)
        if (ts.isConditionalExpression(body)) {
            assert.ok(ts.isBinaryExpression(body.condition))
            assert.equal(body.condition.operatorToken.kind, ts.SyntaxKind.GreaterThanToken)
            assert.equal(body.whenTrue.getText(ast), 'firstRef')
            assert.equal(body.whenFalse.getText(ast), 'secondRef')
            assert.equal(evaluate(1, 2, firstRef, secondRef, () => firstRef), secondRef)
        }
    }
})

test('原样 Ref 标记可以嵌入条件表达式并只跳过作用域内解包', () => {
    const compileBinding = (expression: string) => compileArrangeSfa('<template><Editor :state="' + expression + "\" /></template><script>import { ref } from '@arrange/framework'\n const selectedKey=ref(false); const firstRef=ref(1); const secondRef=ref(2)</script>", '嵌套原样.sfa').code
    const nested = compileBinding('selectedKey.value ? <secondRef> : <firstRef>')
    assert.match(nested, /selectedKey\.value\s*\?\s*secondRef\s*:\s*firstRef/)
    const outer = compileBinding('<selectedKey.value ? secondRef : firstRef>')
    assert.match(outer, /selectedKey\.value\s*\?\s*secondRef\s*:\s*firstRef/)
})

test('SFA 类型检查按 paths 解析定义并拒绝未声明具名内容', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-alias-'))
    try {
        writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { baseUrl: '.', paths: { ...Object.fromEntries(Object.entries(ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile).config.compilerOptions.paths as Record<string, string[]>).map(([name, entries]) => [name, entries.map(entry => resolve(entry))])), '@views/*': ['./*'] } } }))
        writeFileSync(join(directory, 'Receiver.sfa'), '<template><Slot name="header" /></template>')
        writeFileSync(join(directory, 'Good.sfa'), "<template><Receiver><Template #header><Text text=\"标题\" /></Template></Receiver></template><script>import Receiver from \"@views/Receiver.sfa\"\n</script>")
        assert.deepEqual(checkSfaProject(join(directory, 'tsconfig.json'), [join(directory, 'Good.sfa')]), [])

        writeFileSync(join(directory, 'Bad.sfa'), "<template><Receiver><Template #footer><Text text=\"误传\" /></Template></Receiver></template><script>import Receiver from \"@views/Receiver.sfa\"\n</script>")
        const diagnostics = checkSfaProject(join(directory, 'tsconfig.json'), [join(directory, 'Bad.sfa')])
        assert.ok(diagnostics.some(item => item.file.endsWith('Bad.sfa') && item.line === 1 && /never/.test(item.message)), JSON.stringify(diagnostics))
    } finally {
        rmSync(directory, { recursive: true })
    }
})


test('深层 Arrangable 挂载和退休不依赖递归调用栈，生命周期仍为子先父后', () => {
    const native = recordingNative()
    const events: string[] = []
    const depth = 1800
    let definition: runtime.ArrangableDefinition = foundation.Text
    for (let level = 0; level < depth; level++) {
        const child: runtime.ArrangableDefinition = definition
        definition = internal.defineArrangable({
            setup(_props, { call }) {
                runtime.onMounted(() => events.push('挂载' + level))
                runtime.onUnmounted(() => events.push('卸载' + level))
                return () => call(0, child, {})
            }
        })
    }
    const before = internal.getArrangeExecutionStats().activeValueBindings
    const app = runtime.createApp(definition)
    app.mount(native.target)
    assert.equal(events.length, depth)
    assert.equal(events[0], '挂载0')
    assert.equal(events[depth - 1], '挂载' + (depth - 1))
    app.unmount()
    assert.equal(events.length, depth * 2)
    assert.equal(events[depth], '卸载0')
    assert.equal(events.at(-1), '卸载' + (depth - 1))
    assert.equal(internal.getArrangeExecutionStats().activeValueBindings, before)
    assert.equal(native.nodes.size, 0)
})

test('挂载后续分支失败时取消成功通知并退休已创建的作用域', async () => {
    const events: string[] = []
    const native = recordingNative()
    const before = internal.getArrangeExecutionStats().activeValueBindings
    const Good = internal.defineArrangable({
        setup(_props, { call }) {
            runtime.onMounted(() => events.push('不应挂载成功'))
            runtime.onScopeDispose(() => events.push('清理'))
            return () => call(0, foundation.Text, { text: () => '先创建的内容' })
        }
    })
    const app = runtime.createApp(internal.defineArrangable({
        setup: (_props, { call }) => () => {
            call(0, Good, {})
            call(1, foundation.Spacer, { unknown: () => 1 } as never)
        }
    }))
    assert.throws(() => app.mount(native.target), /未声明参数/)
    await runtime.nextTick()
    assert.deepEqual(events, ['清理'])
    assert.equal(internal.getArrangeExecutionStats().activeValueBindings, before)
    assert.equal(native.nodes.size, 0)
})


test('固定参数和对象参数纯值更新均不重排，默认值工厂按实例求值', async () => {
    const run = async (binding: string) => {
        let defaults = 0
        const Probe = internal.defineArrangable({
            props: {
                amount: { type: Number, required: true }, label: {
                    type: String, default: () => {
                        defaults++
                        return '值'
                    }
                }
            },
            setup: (props, { call }) => () => call(0, foundation.Text, { text: () => props.label + props.amount }),
        })
        const Wrapper = evaluateSfa('<template><Probe ' + binding + ' /></template><script>defineProps<{ amount: number }>()</script>')
        const amount = runtime.ref(0)
        const native = recordingNative()
        const app = runtime.createApp(internal.defineArrangable({ setup: (_props, { call }) => () => call(0, Wrapper, { amount: () => amount.value }) }))
        app.arrangable('Probe', Probe)
        app.mount(native.target)
        const baseline = internal.getArrangeExecutionStats()
        for (let index = 1; index <= 40; index++) {
            amount.value = index
            await runtime.nextTick()
        }
        const after = internal.getArrangeExecutionStats()
        assert.equal(defaults, 1)
        assert.ok(native.textNodes().some(node => node.text === '值40'))
        app.unmount()
        return { names: after.parameterNameChecks - baseline.parameterNameChecks, evaluations: after.valueEvaluations - baseline.valueEvaluations, structure: after.structureRuns - baseline.structureRuns }
    }
    const fixed = await run(':amount="amount"')
    const dynamic = await run('a-bind="{ amount }"')
    assert.equal(fixed.structure, 0)
    assert.equal(dynamic.structure, 0)
    assert.equal(fixed.names, 0)
    assert.equal(dynamic.names, 0)
    assert.ok(dynamic.evaluations > fixed.evaluations)
    console.log('固定参数与对象表达式求值对比：' + JSON.stringify({ fixed, dynamic }))
})


test('真实 SFA 原样 Ref 保留身份，切换本体退订旧值，只读状态不能传给可写声明', async () => {
    const first = runtime.ref(1)
    const second = runtime.ref(10)
    const selected = runtime.ref(false)
    const observed: unknown[] = []
    const Editor = evaluateSfa("<template><Text :text=\"String(oriRef.value)\" /></template><script>import type { Ref } from '@arrange/framework'\n import { observed } from \"harness\";\n const props = defineProps<{ oriRef: Ref<number> }>(); observed.push(props.oriRef)</script>", { harness: { observed } })
    const Page = evaluateSfa("<template><Editor a-bind:ori-ref.camel=\"<selected.value ? second : first>\" /></template><script>import Editor from \"./Editor.sfa\";\n import { selected, first, second } from \"harness\"\n</script>", { './Editor.sfa': { default: Editor }, harness: { selected, first, second } })
    const native = recordingNative()
    const app = runtime.createApp(Page)
    app.mount(native.target)
    assert.equal(observed[0], first)
    const before = internal.getArrangeExecutionStats()
    first.value = 2
    await runtime.nextTick()
    assert.ok(native.textNodes().some(node => node.text === '2'))
    assert.equal(internal.getArrangeExecutionStats().structureRuns, before.structureRuns)

    selected.value = true
    await runtime.nextTick()
    assert.ok(native.textNodes().some(node => node.text === '10'))
    const switched = internal.getArrangeExecutionStats()
    first.value = 3
    await runtime.nextTick()
    assert.equal(internal.getArrangeExecutionStats().valueEvaluations, switched.valueEvaluations)
    second.value = 11
    await runtime.nextTick()
    assert.ok(native.textNodes().some(node => node.text === '11'))
    assert.equal(internal.getArrangeExecutionStats().structureRuns, before.structureRuns)
    app.unmount()

    assert.throws(() => runtime.createApp(Editor, { oriRef: runtime.readonly(first) }).mount(recordingNative().target), /可写.*Ref/)
    assert.throws(() => runtime.createApp(Editor, { oriRef: { value: 1 } }).mount(recordingNative().target), /Ref 本体/)
    const ReadOnlyEditor = evaluateSfa("<template><Text :text=\"String(oriRef.value)\" /></template><script>import type { Ref } from '@arrange/framework'\n defineProps<{ oriRef: Readonly<Ref<number>> }>()</script>")
    const readOnly = runtime.readonly(second)
    const readApp = runtime.createApp(ReadOnlyEditor, { oriRef: readOnly })
    readApp.mount(recordingNative().target)
    assert.ok(runtime.isReadonly(readOnly))
    readApp.unmount()
})


test('深层实际 LayoutNode 账本按任务栈创建和退休', () => {
    let definition: runtime.ArrangableDefinition = foundation.Text
    const depth = 1200
    for (let level = 0; level < depth; level++) {
        const child: runtime.ArrangableDefinition = definition
        definition = internal.defineArrangable({ setup: (_props, { call }) => () => call(0, foundation.Box, {}, { default: () => call(0, child, {}) }) })
    }
    const native = recordingNative()
    const before = internal.getArrangeExecutionStats().activeValueBindings
    const app = runtime.createApp(definition)
    app.mount(native.target)
    assert.equal(native.nodes.size, depth + 2)
    app.unmount()
    assert.equal(native.nodes.size, 0)
    assert.equal(internal.getArrangeExecutionStats().activeValueBindings, before)
})

test('Ref 声明沿泛型别名及真实导入身份推断，不按名字猜测', () => {
    const kinds = (declarations: string, type: string) => {
        const definition = evaluateSfa('<script>import type { Ref, ComputedRef } from "@arrange/framework"; ' + declarations + '; defineProps<{ state: ' + type + ' }>()</script>')
        return (definition as { props: Record<string, { refKind?: string }> }).props.state.refKind
    }
    assert.equal(kinds('type Identity<T> = T; type State<T> = Identity<Ref<T>>', 'State<number>'), 'writable')
    assert.equal(kinds('type Identity<T> = T', 'Identity<Readonly<Ref<number>>>'), 'readonly')
    assert.equal(kinds('type State<T = Ref<number>> = T', 'State'), 'writable')
    assert.equal(kinds('', 'Ref<number> | ComputedRef<number>'), 'readonly')
    const local = evaluateSfa('<script>type Ref<T> = { value: T }; defineProps<{ state: Ref<number> }>()</script>')
    assert.equal((local as { props: Record<string, { refKind?: string }> }).props.state.refKind, undefined)
})


test('同一参数组同时改变时校验完整新值，无关表达式保留缓存', async () => {
    const lower = runtime.ref(1)
    const upper = runtime.ref(2)
    const other = runtime.ref('独立')
    let otherReads = 0
    const snapshots: string[] = []
    const Receiver = internal.defineArrangable({
        props: { lower: { type: Number, validator: (value: unknown, props: Record<string, unknown>) => Number(value) < Number(props.upper) }, upper: Number, other: String },
        setup(props, { call }) {
            runtime.watch(() => [props.lower, props.upper], values => snapshots.push(values.join('/')))
            return () => call(0, foundation.Text, { text: () => props.lower + '/' + props.upper })
        },
    })
    const app = runtime.createApp(internal.defineArrangable({
        setup: (_props, { call }) => () => call(0, Receiver, {
            lower: () => lower.value, upper: () => upper.value, other: () => {
                otherReads++
                return other.value
            }
        })
    }))
    const native = recordingNative()
    app.mount(native.target)
    lower.value = 10
    upper.value = 20
    await runtime.nextTick()
    assert.deepEqual(snapshots, ['10/20'])
    assert.equal(otherReads, 1)
    assert.ok(native.textNodes().some(node => node.text === '10/20'))
    app.unmount()
})

test('稳定参数与内容描述跨外层重排复用，动态调用保持同一结果', async () => {
    const run = async (attributes: string) => {
        const amount = runtime.ref(1)
        const visible = runtime.ref(false)
        const Page = evaluateSfa('<template><Text ' + attributes + " /><Box><Text text=\"内容\" /></Box><Spacer a-if=\"visible\" /></template><script>import { amount, visible } from \"harness\"\n</script>", { harness: { amount, visible } })
        const native = recordingNative()
        const app = runtime.createApp(Page)
        app.mount(native.target)
        const before = internal.getArrangeExecutionStats()
        for (let index = 0; index < 12; index++) {
            visible.value = !visible.value
            await runtime.nextTick()
        }
        amount.value = 2
        await runtime.nextTick()
        assert.ok(native.textNodes().some(node => node.text === '2'))
        const after = internal.getArrangeExecutionStats()
        app.unmount()
        return { evaluations: after.valueEvaluations - before.valueEvaluations, structure: after.structureRuns - before.structureRuns, names: after.parameterNameChecks - before.parameterNameChecks }
    }
    const fixed = await run(':text="String(amount)"')
    const dynamic = await run('a-bind="{ text: String(amount) }"')
    assert.equal(dynamic.structure, fixed.structure)
    assert.equal(dynamic.names, fixed.names)
    assert.ok(dynamic.evaluations > fixed.evaluations)
    console.log('局部条件与参数求值对比：' + JSON.stringify({ fixed, dynamic }))
})


test('Painter 资源状态保留版本、失败、取消和所属作用域释放', () => {
    const previous = globalThis.__ARRANGE_NATIVE__
    const callbacks: ((completion: { contentVersion: number; width?: number; height?: number; error?: string }) => void)[] = []
    const retired: bigint[] = []
    globalThis.__ARRANGE_NATIVE__ = {
        ...recordingNative().target,
        acquirePainter(_location, complete) {
            callbacks.push(complete)
            return { identity: BigInt(callbacks.length), generation: 1n }
        },
        releasePainter(handle) { retired.push(handle.identity) },
    }
    try {
        const scope = runtime.effectScope()
        const image = scope.run(() => ui.painter('图片.svg'))!
        assert.equal(image.status, 'loading')
        callbacks[0]({ contentVersion: 2, width: 24, height: 12 })
        assert.equal(image.status, 'ready')
        assert.deepEqual(image.intrinsicSize, { width: 24, height: 12 })
        callbacks[0]({ contentVersion: 1, width: 1, height: 1 })
        assert.equal(image.contentVersion, 2)
        scope.stop()
        image.dispose()
        callbacks[0]({ contentVersion: 4, width: 48, height: 48 })
        assert.equal(image.status, 'disposed')
        assert.equal(image.intrinsicSize, undefined)
        assert.deepEqual(retired, [1n])

        const failed = ui.painter('损坏.png')
        callbacks[1]({ contentVersion: 1, error: '解码失败' })
        assert.equal(failed.status, 'failed')
        assert.equal(failed.error, '解码失败')
        assert.throws(() => ui.M.paint(failed), /解码失败/)
        failed.dispose()
        assert.deepEqual(retired, [1n, 2n])
    } finally {
        globalThis.__ARRANGE_NATIVE__ = previous
    }
})


test('跨文件 Ref 转导出保留身份，循环转导出产生定位诊断', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-ref-exports-'))
    try {
        writeFileSync(join(directory, 'state.ts'), 'export type { Ref as State } from "@arrange/framework"')
        writeFileSync(join(directory, 'barrel.ts'), 'export type { State } from "./state"')
        const source = "<script>import type { State } from \"./barrel\";\n defineProps<{ state: State<number> }>()</script>"
        const result = compileArrangeSfa(source, join(directory, 'Page.sfa'))
        assert.match(result.code, /refKind: 'writable'/)
        assert.ok(result.dependencies.some(file => file.endsWith('state.ts')))
        assert.ok(result.dependencies.some(file => file.endsWith('barrel.ts')))

        writeFileSync(join(directory, 'a.ts'), 'export type { State } from "./b"')
        writeFileSync(join(directory, 'b.ts'), 'export type { State } from "./a"')
        assert.throws(() => compileArrangeSfa("<script>import type { State } from \"./a\";\n defineProps<{ state: State }>()</script>", join(directory, 'Cycle.sfa')), /类型转导出存在循环/)
    } finally {
        rmSync(directory, { recursive: true })
    }
})


test('错误处理器接收挂载失败后不产生成功生命周期，后续应用仍可挂载', () => {
    for (const phase of ['初始化', '重排', '值求值']) {
        const events: string[] = []
        const Broken = internal.defineArrangable({
            setup(_props, { call }) {
                runtime.onMounted(() => events.push('不应成功'))
                runtime.onScopeDispose(() => events.push('已清理'))
                if (phase === '初始化') throw new Error(phase)
                return () => {
                    if (phase === '重排') throw new Error(phase)
                    call(0, foundation.Text, { text: () => { throw new Error(phase) } })
                }
            }
        })
        const app = runtime.createApp(Broken)
        app.config.errorHandler = () => events.push('已报告')
        assert.throws(() => app.mount(recordingNative().target), new RegExp(phase))
        assert.ok(events.includes('已清理'))
        assert.ok(!events.includes('不应成功'))
        const healthy = runtime.createApp(foundation.Text, { text: '恢复' })
        const native = recordingNative()
        healthy.mount(native.target)
        assert.ok(native.textNodes().some(node => node.text === '恢复'))
        healthy.unmount()
    }
})


test('固定参数及动态参数组拒绝时保留真实 SFA 位置', () => {
    for (const parameters of ['unknown="误传"', 'text="文字" :singleLine="123"', 'a-bind="{ text: 123 }"', 'a-bind="{ text: 1, Text: 2 }"']) {
        const Page = evaluateSfa('<template>\n    <Text ' + parameters + ' />\n</template>')
        assert.throws(() => runtime.createApp(Page).mount(recordingNative().target), error => error instanceof Error && /契约.sfa:2:/.test(error.message))
    }
})
