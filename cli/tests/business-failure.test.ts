import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationCommand } from '../src/business/ApplicationCommand.ts'
import { WorkPresenter } from '../src/business/WorkPresenter.ts'
import type { TaskView } from '../src/terminal/Presentation.ts'

test('命令结果跨嵌套子命令收集，每次调用重置且不同应用互不影响', async () => {
    let closed = 0
    const command = new ApplicationCommand({ close: async () => { closed++ } }).exitOverride()
    const nested = command.command('storage').command('inspect <name>').option('--failed')
    nested.action(function(name: string, options: { failed?: boolean }) {
        assert.equal(this, nested)
        assert.equal(name, 'test')
        return options.failed ? 5 : undefined
    })
    const previousExitCode = process.exitCode
    await command.parseAsync(['node', 'arrange', 'storage', 'inspect', 'test', '--failed'])
    assert.equal(command.resultCode, 5)
    assert.equal(nested.resultCode, 5)
    const independent = new ApplicationCommand({ close: async () => { } }).exitOverride()
    independent.action(() => { })
    await independent.parseAsync(['node', 'arrange'])
    assert.equal(independent.resultCode, 0)
    assert.equal(command.resultCode, 5)
    await command.parseAsync(['node', 'arrange', 'storage', 'inspect', 'test'])
    assert.equal(command.resultCode, 0)
    assert.equal(nested.resultCode, 0)
    assert.equal(closed, 2)
    assert.equal(process.exitCode, previousExitCode)
})

test('命令失败与资源收尾同时失败时保留两个原始原因', async () => {
    const primary = new Error('构建失败'), cleanup = new Error('资源释放失败')
    const command = new ApplicationCommand({ close: async () => { throw cleanup } }).exitOverride()
    command.command('build').action(() => { throw primary })
    await assert.rejects(command.parseAsync(['node', 'arrange', 'build']), error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [primary, cleanup])
        assert.match(error.message, /构建失败.*资源释放失败/)
        return true
    })
})

test('任务业务失败与呈现收尾同时失败时不覆盖业务原始错误', async () => {
    const primary = new Error('编译器退出码 7'), cleanup = new Error('控制台收尾失败')
    const view: TaskView = {
        group: () => ({
            task: () => ({
                start() { }, waiting() { }, stage() { }, progress() { }, note() { }, console() { }, log() { },
                finish: async () => { throw cleanup }
            }),
            complete() { }
        })
    }
    await assert.rejects(new WorkPresenter(view).run({ id: 'build', title: '构建' }, async () => { throw primary }), error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [primary, cleanup])
        assert.match(error.message, /编译器退出码 7.*控制台收尾失败/)
        return true
    })
})
