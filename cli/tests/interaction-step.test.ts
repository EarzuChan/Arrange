import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { TerminalSession } from '../src/terminal/TerminalSession.ts'
import { commandInterface, type CommandInterface } from '../src/business/CommandInterface.ts'
import { ScanPresentation } from '../src/business/ScanPresentation.ts'
import { SyncWizard } from '../src/business/wizard/Sync.ts'
import { SetupWizard } from '../src/business/wizard/Setup.ts'
import { promptManagedItems } from '../src/business/wizard/Project.ts'
import { configRegistry } from '../src/feature/config/ConfigRegistry.ts'
import type { ConfigScanReport } from '../src/feature/sync/ConfigScanReport.ts'
import type { SetupScanReport } from '../src/feature/sync/SetupScanReport.ts'
import { observePrompts, stateFor } from './fixture.ts'

async function conversation(body: (terminal: CommandInterface) => Promise<void>, answers: readonly unknown[] = []): Promise<string> {
    let transcript = '', index = 0
    const driver = Object.assign(new EventEmitter(), {
        columns: 120, rows: 40, host: new EventEmitter(), output: { isTTY: true }, enter() { },
        writeFrame(frame: string) { if (frame.includes('按 Enter')) driver.emit('input', { kind: 'key', key: 'enter' }) },
        async close(text = '') { transcript = text }
    })
    const session = new TerminalSession(driver)
    const code = await session.run(async (ui, signal) => {
        const terminal = observePrompts(commandInterface(ui, signal), async (request, next) => {
            assert.ok(index < answers.length, `缺少问题答案：${request.message}`)
            const answer = answers[index++]
            const pending = next()
            const options = request.options ?? []
            const available = options.filter(option => !option.disabled)
            const position = available.findIndex(option => option.value === answer)
            assert.ok(position >= 0, `答案必须在选项中：${String(answer)}`)
            driver.emit('input', { kind: 'key', key: 'home' })
            for (let step = 0; step < position; step++) driver.emit('input', { kind: 'key', key: 'down' })
            driver.emit('input', { kind: 'key', key: 'enter' })
            return pending
        })
        await body(terminal)
    })
    assert.equal(code, 0, transcript)
    assert.equal(index, answers.length)
    return transcript
}

test('CONFIG 重扫替换旧报告与修正询问，最终只保留完成结果', async () => {
    const text = await conversation(async terminal => {
        const presentation = new ScanPresentation(terminal)
        const wizard = new SyncWizard(terminal, presentation)
        const report: ConfigScanReport = { scope: 'Global', fatal: [], resolvable: [], applicable: [], idle: [] }
        await presentation.status('检查工程配置', async () => report)
        wizard.report(report)
        assert.equal(await wizard.edit('第一次编辑提示'), true)
        await presentation.status('检查工程配置', async () => report)
        wizard.report(report)
        wizard.message('CONFIG 完成', 'completed')
        terminal.reporter.success('同步完成')
    }, [true])
    assert.match(text, /检查结果[\s\S]*CONFIG 完成/)
    assert.doesNotMatch(text, /第一次编辑|编辑完成|检查工程配置|Fatal|Resolvable/)
})

test('SETUP 重扫撤下旧报告和工具确认，真实任务及控制台仍完整保留', async () => {
    const text = await conversation(async terminal => {
        const presentation = new ScanPresentation(terminal)
        const wizard = new SetupWizard(terminal, presentation)
        const state = stateFor(process.cwd())
        const report: SetupScanReport = { scope: 'Global', state, snapshots: [], proposedLocal: {}, fatal: [], resolvable: [], applicable: [], idle: [] }
        await presentation.status('扫描本机工具', async () => report)
        wizard.report(report)
        assert.equal(await wizard.acceptTools({ node: { path: 'node', version: '24' } }), true)
        await presentation.status('扫描本机工具', async () => report)
        wizard.report(report)
        await presentation.all([{ spec: { id: 'prepare', title: '实际安装' }, run: async task => { task.line('安装工具的完整输出') } }])
        wizard.message('SETUP 完成', 'completed')
    }, [true])
    assert.doesNotMatch(text, /检测到以下本机工具|保存并使用|扫描本机工具/)
    assert.match(text, /SETUP Global[\s\S]*实际安装[\s\S]*安装工具的完整输出[\s\S]*SETUP 完成/)
    assert.match(text, /╰─已完成/)
})

test('扫描失败替换原状态为一次原因，只读报告保留且不会阻挡下一阶段', async () => {
    const text = await conversation(async terminal => {
        const presentation = new ScanPresentation(terminal)
        await assert.rejects(presentation.status('扫描', async () => { throw new Error('扫描连接失败') }), /扫描连接失败/)
        presentation.failure('CONFIG 失败：扫描连接失败')
        await presentation.status('再次扫描', async () => undefined)
        presentation.report('step', ['只读扫描结果'], true)
        terminal.reporter.success('扫描结束')
    })
    assert.equal((text.match(/扫描连接失败/g) ?? []).length, 1)
    assert.match(text, /只读扫描结果[\s\S]*扫描结束/)
})

test('逐项托管询问收束为所选配置项，不残留总开关和逐项答案', async () => {
    const items = configRegistry.items.slice(0, 2)
    const text = await conversation(async terminal => {
        const selected = await promptManagedItems(terminal, items)
        assert.deepEqual(selected, { [items[0]!.id]: true, [items[1]!.id]: false })
        terminal.reporter.success('选择完成')
    }, [false, true, false])
    assert.match(text, /持续托管配置项/)
    assert.ok(text.includes(items[0]!.label))
    assert.ok(!text.includes(items[1]!.label))
    assert.doesNotMatch(text, /持续托管全部支持|？/)
})
