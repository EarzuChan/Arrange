import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationCommand } from '../src/business/ApplicationCommand.ts'
import { registerCreateCommand } from '../src/business/command/Create.ts'
import { registerAdoptCommand } from '../src/business/command/Adopt.ts'
import { registerSyncCommand } from '../src/business/command/Sync.ts'
import { ProjectInteractionCancelled, type ProjectInteraction } from '../src/feature/project/ProjectInteraction.ts'
import type { CreateProjectRequest } from '../src/feature/project/CreateProject.ts'
import type { InitializationPlan } from '../src/feature/project/ProjectInitializer.ts'
import type { SyncResult, SyncRunOptions } from '../src/feature/sync/SyncService.ts'
import { quietTerminal, stateFor } from './fixture.ts'
import { join } from 'node:path'
import { projectLocationHint } from '../src/business/ProjectLocation.ts'

const request: CreateProjectRequest = { rootDir: process.cwd(), projectName: 'TestPlugin', projectVersion: '1.0.0', frameworkVersion: '0.0.0-m.2.2', vendorName: 'Test Vendor', vendorCode: 'Test', pluginCode: 'TstP', pluginType: 'effect', packageManager: 'npm', products: ['standalone'], uiDirectory: 'ui', nativeDirectory: 'native', artifactsDirectory: 'artifacts', managedItems: {} }

test('创建与接入将各阶段失败作为调用结果，保持初始化和同步顺序', async t => {
    const previousExitCode = process.exitCode
    for (const name of ['create', 'adopt'] as const) for (const statuses of [['completed'], ['blocked'], ['failed'], ['aborted'], ...(name === 'adopt' ? [['completed', 'failed'], ['completed', 'aborted']] : [])] as SyncResult['status'][][]) {
        const terminal = quietTerminal()
        t.after(() => terminal.close())
        const state = stateFor(process.cwd())
        const plan: InitializationPlan = { state, files: [], guards: [], copies: [], icons: [] }
        const sequence: string[] = []
        const initializer = {
            planCreate: async () => {
                sequence.push('plan')
                return plan
            },
            planAdopt: async () => {
                sequence.push('plan')
                return plan
            },
            apply: async () => {
                sequence.push('apply')
                return state
            }
        }
        const interaction: ProjectInteraction = {
            create: async () => {
                sequence.push('request')
                return request
            },
            adopt: async () => {
                sequence.push('request')
                return { state, ui: { kind: 'existing' }, native: { kind: 'existing' } }
            },
            confirmInitialization: async () => {
                sequence.push('confirm')
                return true
            },
            confirm: async () => true, message() { }, failure() { }
        }
        let index = 0
        const sync = {
            run: async (options: SyncRunOptions): Promise<SyncResult> => {
                sequence.push(options.configOnly ? 'config' : options.setupOnly ? 'setup' : 'sync')
                return { status: statuses[index++] ?? 'completed' }
            }
        }
        const command = new ApplicationCommand({ close: async () => { sequence.push('close') } }).exitOverride()
        if (name === 'create') registerCreateCommand(command, initializer, sync, interaction, terminal.reporter)
        else registerAdoptCommand(command, initializer, sync, interaction, terminal.reporter)
        await command.parseAsync(['node', 'arrange', name])
        assert.equal(command.resultCode, statuses.some(status => status !== 'completed') ? 1 : 0, name + '：' + statuses.join(' → '))
        assert.deepEqual(sequence, ['request', 'plan', 'confirm', 'apply', ...(name === 'create' ? ['sync'] : statuses[0] === 'completed' ? ['config', 'setup'] : ['config']), 'close'])
        assert.equal(process.exitCode, previousExitCode)
    }
})

test('创建与接入的用户拒绝和普通异常保留原结果，且不会继续初始化', async t => {
    const previousExitCode = process.exitCode
    for (const name of ['create', 'adopt'] as const) for (const outcome of ['declined', 'cancelled', 'failed'] as const) {
        const terminal = quietTerminal()
        t.after(() => terminal.close())
        const receive = async (): Promise<false> => {
            if (outcome === 'cancelled') throw new ProjectInteractionCancelled()
            if (outcome === 'failed') throw new Error('读取请求失败')
            return false
        }
        const unexpected = async (): Promise<never> => { throw new Error('不应继续初始化或同步') }
        const interaction: ProjectInteraction = { create: receive, adopt: receive, confirmInitialization: unexpected, confirm: unexpected, message() { }, failure() { } }
        const initializer = { planCreate: unexpected, planAdopt: unexpected, apply: unexpected }
        const command = new ApplicationCommand({ close: async () => { } }).exitOverride()
        if (name === 'create') registerCreateCommand(command, initializer, { run: unexpected }, interaction, terminal.reporter)
        else registerAdoptCommand(command, initializer, { run: unexpected }, interaction, terminal.reporter)
        await command.parseAsync(['node', 'arrange', name])
        assert.equal(command.resultCode, outcome === 'failed' ? 1 : 0)
        assert.equal(process.exitCode, previousExitCode)
        await terminal.close()
        assert.match(terminal.output.text, outcome === 'failed' ? /读取请求失败/ : /已取消/)
    }
})

test('同步扫描的完成、阻塞、放弃和失败通过返回值传递，宿主退出码不变', async t => {
    const previousExitCode = process.exitCode
    for (const status of ['completed', 'blocked', 'aborted', 'failed'] as const) {
        const terminal = quietTerminal()
        t.after(() => terminal.close())
        const command = new ApplicationCommand({ close: async () => { } }).exitOverride()
        registerSyncCommand(command, { run: async () => ({ status }) }, terminal.reporter)
        await command.parseAsync(['node', 'arrange', 'sync', '--scan'])
        assert.equal(command.resultCode, status === 'completed' ? 0 : 1)
        assert.equal(process.exitCode, previousExitCode)
    }
})

test('创建和接入在子目录时给出相对 cd 指令，当前目录不多加提示且不改变同步目标', async () => {
    for (const name of ['create', 'adopt'] as const) for (const subdirectory of [false, true]) for (const outcome of ['completed', 'declined', 'failed'] as const) {
        const root = subdirectory ? join(process.cwd(), '我的 Plugin') : process.cwd()
        const state = stateFor(root)
        const plan: InitializationPlan = { state, files: [], guards: [], copies: [], icons: [] }
        const terminal = quietTerminal()
        const interaction: ProjectInteraction = {
            create: async () => ({ ...request, rootDir: root }),
            adopt: async () => ({ state, ui: { kind: 'existing' }, native: { kind: 'existing' } }),
            confirmInitialization: async () => true,
            confirm: async () => outcome !== 'declined',
            message: message => terminal.reporter.info(message),
            failure: message => terminal.reporter.error(message)
        }
        let calls = 0
        const sync = {
            run: async (options: SyncRunOptions, directory: string): Promise<SyncResult> => {
                assert.equal(directory, root)
                calls++
                return { status: options.configOnly || outcome !== 'failed' ? 'completed' : 'failed' }
            }
        }
        const initializer = { planCreate: async () => plan, planAdopt: async () => plan, apply: async () => state }
        const command = new ApplicationCommand({ close: async () => { } }).exitOverride()
        if (name === 'create') registerCreateCommand(command, initializer, sync, interaction, terminal.reporter)
        else registerAdoptCommand(command, initializer, sync, interaction, terminal.reporter)
        await command.parseAsync(['node', 'arrange', name])
        await terminal.close()
        assert.equal(calls, (name === 'adopt' ? 1 : 0) + (outcome === 'declined' ? 0 : 1))
        assert.equal(command.resultCode, outcome === 'failed' ? 1 : 0)
        if (subdirectory) assert.match(terminal.output.text, /请先运行 cd '我的 Plugin' 进入您工程的目录/)
        else assert.doesNotMatch(terminal.output.text, /请先运行 cd/)
        assert.doesNotMatch(terminal.output.text, /您的工程根位于|工程已创建：/)
    }
})

test('切换目录提示按本机 shell 引用空格和单引号，选项前缀与通配符不会误解释', () => {
    assert.equal(projectLocationHint(process.cwd()), '')
    const apostrophe = projectLocationHint(join(process.cwd(), "Earzu's Plugin"))
    assert.ok(apostrophe.includes(process.platform === 'win32' ? "cd 'Earzu''s Plugin'" : "cd 'Earzu'\\''s Plugin'"))
    const dash = projectLocationHint(join(process.cwd(), '-Plugin'))
    assert.ok(dash.includes(process.platform === 'win32' ? "cd '.\\-Plugin'" : "cd './-Plugin'"))
    assert.match(projectLocationHint(join(process.cwd(), '[Plugin]')), process.platform === 'win32' ? /cd -LiteralPath '\[Plugin\]'/ : /cd '\[Plugin\]'/)
})
