import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { EventEmitter } from 'node:events'
import test, { type TestContext } from 'node:test'
import { cliCompatibility, frameworkVerificationConcurrency } from '../src/CliMetadata.ts'
import { selectFrameworkVersion } from '../src/business/wizard/FrameworkVersion.ts'
import { commandInterface } from '../src/business/CommandInterface.ts'
import { FrameworkService, type FrameworkSelectionInput, type VerifiedFrameworkVersion } from '../src/feature/framework/FrameworkService.ts'
import { FrameworkRegistryClient } from '../src/feature/framework/FrameworkRegistryClient.ts'
import type { FrameworkVersionCandidate } from '../src/feature/framework/FrameworkMamba.ts'
import { RegistryUnreachableError } from '../src/feature/framework/FrameworkErrors.ts'
import { SourceUnavailableError, SourceTagMissingError } from '../src/feature/source/GitSource.ts'
import type { PromptRequest } from '../src/terminal/PromptController.ts'
import { TerminalSession } from '../src/terminal/TerminalSession.ts'
import { PromptCancelled } from '../src/business/PromptUtils.ts'
import { observePrompts } from './fixture.ts'
import { stripAnsi } from '../src/util/TerminalText.ts'
import type { TaskOutput } from '../src/feature/operation/Work.ts'

const version = '1.2.3'
const metadata = (version: string, compatibility: number | null = cliCompatibility): FrameworkVersionCandidate => ({ version, cliCompatibility: compatibility, markedLatest: false, publishedAt: null })
const verified = (version: string): VerifiedFrameworkVersion => ({ version, cliCompatibility, registryUrl: 'https://registry.example.invalid', repositoryUrl: 'https://source.example.invalid/Arrange.git', commit: 'a'.repeat(40) })

class Registry extends FrameworkRegistryClient {
    calls = 0
    versions = [metadata(version)]
    load: () => Promise<FrameworkVersionCandidate[]> = async () => this.versions
    override async fetchCandidates() {
        this.calls++
        return this.load()
    }
}

class Framework extends FrameworkService {
    readonly calls: string[] = []
    readonly customCalls: string[] = []
    inFlight = 0
    maxInFlight = 0
    validate: (version: string, task: TaskOutput) => Promise<VerifiedFrameworkVersion> = async version => verified(version)
    override async verifyCandidate(candidate: FrameworkVersionCandidate, _input: FrameworkSelectionInput, task: TaskOutput) {
        this.calls.push(candidate.version)
        this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight)
        try { return await this.validate(candidate.version, task) } finally { this.inFlight-- }
    }
    override async selectVersion(version: string, _input: FrameworkSelectionInput, task: TaskOutput) {
        this.customCalls.push(version)
        return this.validate(version, task)
    }
}

function fixture(t: TestContext, suggestion?: string) {
    const registry = new Registry()
    const framework = new Framework(registry)
    let frame = '', transcript = ''
    const driver = Object.assign(new EventEmitter(), { columns: 120, rows: 40, host: new EventEmitter(), output: { isTTY: true }, enter() { }, writeFrame(text: string) { frame = text }, async close(text = '') { transcript = text } })
    const session = new TerminalSession(driver)
    const questions: PromptRequest[] = []
    let current: PromptRequest | undefined
    let result: VerifiedFrameworkVersion | undefined
    let failure: unknown
    const running = Promise.resolve().then(() => session.run(async (ui, signal) => {
        const terminal = observePrompts(commandInterface(ui, signal), async (request, next) => {
            questions.push(request)
            current = request
            try { return await next() } finally { if (current === request) current = undefined }
        })
        try { result = await selectFrameworkVersion(terminal, framework, { suggestion }) } catch (error) { failure = error }
    }))
    const settled = async () => {
        for (let attempt = 0; attempt < 500; attempt++) {
            if (result || failure) return
            await delay(2)
        }
        assert.fail('版本选择未结束')
    }
    t.after(async () => {
        driver.emit('signal', 'SIGTERM')
        await running
    })
    const wait = async (question: string) => {
        for (let attempt = 0; attempt < 500; attempt++) {
            if (current?.message.includes(question)) return
            if (failure) throw failure
            await delay(2)
        }
        assert.fail(`未出现预期问题 ${question}，当前 ${current?.message}`)
    }
    const key = (key: string) => driver.emit('input', { kind: 'key', key })
    const choose = (value: unknown) => {
        const options = current?.options ?? []
        const target = options.find(option => option.value === value)
        assert.ok(target && !target.disabled, `选项必须存在且可选：${String(value)}`)
        key('home')
        for (const option of options) {
            if (option.disabled) continue
            if (option.value === value) break
            key('down')
        }
        key('enter')
        current = undefined
    }
    const finish = async () => {
        await settled()
        for (let attempt = 0; attempt < 500 && !stripAnsi(frame).includes('按 Enter'); attempt++) await delay(2)
        assert.match(stripAnsi(frame), /按 Enter/)
        key('enter')
        await running
        return transcript
    }
    return { registry, framework, controller: { cancel: () => key('escape') }, current: () => current!, result: () => result, failure: () => failure, questions, get running() { return settled() }, wait, key, choose, paste: (text: string) => driver.emit('input', { kind: 'paste', text }), frame: () => stripAnsi(frame), finish }
}

test('读取失败只展示一次，重试撤下旧错误与选择过程，确认后拍扁只留最终版本', async t => {
    const input = fixture(t)
    input.registry.load = async () => { throw new RegistryUnreachableError('registry', '本次连接被拒绝') }
    await input.wait('无法读取')
    await delay(25)
    assert.equal((input.frame().match(/本次连接被拒绝/g) ?? []).length, 1)
    assert.equal((input.frame().match(/读取 Arrange Framework 版本/g) ?? []).length, 1)
    let release!: () => void
    input.registry.load = () => new Promise(resolve => { release = () => resolve(input.registry.versions) })
    input.choose('retry')
    await delay(30)
    assert.match(input.frame(), /读取 Arrange Framework 版本/)
    assert.doesNotMatch(input.frame(), /本次连接被拒绝|无法读取 Framework 版本列表|如何处理/)
    release()
    await input.wait('选择 Arrange')
    await delay(25)
    assert.doesNotMatch(input.frame(), /读取 Arrange Framework 版本|检查 Framework 候选版本/)
    input.choose(version)
    await input.wait('确认使用')
    input.choose(false)
    await input.wait('选择 Arrange')
    await delay(25)
    assert.doesNotMatch(input.frame(), /确认使用/)
    input.choose(version)
    await input.wait('确认使用')
    input.choose(true)
    const text = await input.finish()
    assert.match(text, /◇  Arrange Framework 版本\n│  1.2.3/)
    assert.doesNotMatch(text, /连接被拒绝|读取 Arrange|检查 Framework|选择 Arrange|确认使用|重试/)
})

test('候选和自定义预检即使产生真实控制台输出，进入选择题后仍撤下完整检查区块', async t => {
    const input = fixture(t)
    input.framework.validate = async (selected, task) => {
        task.line(`复用 Arrange 源码 · v${selected}`)
        return verified(selected)
    }
    const assertSelection = async () => {
        await input.wait('选择 Arrange')
        await delay(25)
        assert.match(input.frame(), /选择 Arrange Framework 版本/)
        assert.doesNotMatch(input.frame(), /检查 Framework|复用 Arrange 源码|╭|╰|跟随中/)
    }
    await assertSelection()
    input.choose('custom')
    await input.wait('自定义 Arrange')
    input.paste('2.0.0')
    input.key('enter')
    await assertSelection()
    input.choose('2.0.0')
    await input.wait('确认使用')
    input.choose(true)
    const text = await input.finish()
    assert.match(text, /Arrange Framework 版本[\s\S]*2.0.0/)
    assert.doesNotMatch(text, /检查 Framework|复用 Arrange 源码|╭|╰/)
})

test('候选全部验证完成后展示，限制并发且禁用缺契约、缺 tag 和暂时不可达项', async t => {
    const input = fixture(t)
    input.registry.versions = [metadata('1.0.0', null), ...Array.from({ length: 5 }, (_, index) => metadata(`1.0.${index + 1}`))]
    input.framework.validate = async version => {
        await delay(10)
        if (version === '1.0.2') throw new SourceTagMissingError('source', 'v1.0.2')
        if (version === '1.0.3') throw new SourceUnavailableError('源码连接暂时失败')
        return verified(version)
    }
    await input.wait('部分 Framework')
    assert.equal(input.framework.calls.length, 5)
    assert.equal(input.framework.inFlight, 0)
    assert.equal(input.framework.maxInFlight, frameworkVerificationConcurrency)
    input.choose('view-results')
    await input.wait('选择 Arrange')
    const options = input.current().options!
    for (const version of ['1.0.0', '1.0.2', '1.0.3']) assert.equal(options.find(option => option.value === version)!.disabled, true)
    assert.match(options.find(option => option.value === '1.0.3')!.hint!, /暂时无法验证/)
    assert.match(options.find(option => option.value === '1.0.2')!.hint!, /不可用.*没有 tag/)
    input.choose('1.0.1')
    await input.wait('确认使用')
    input.choose(true)
    await input.running
    assert.equal(input.result()!.version, '1.0.1')
})

test('registry 失败由重试循环包裹，重试后验证全部候选，不提前显示版本题', async t => {
    const input = fixture(t)
    input.registry.load = async () => { throw new RegistryUnreachableError('registry', 'HTTP 503') }
    await input.wait('无法读取')
    assert.equal(input.framework.calls.length, 0)
    assert.ok(!input.questions.some(question => question.message.includes('选择 Arrange')))
    input.registry.load = async () => input.registry.versions
    input.choose('retry')
    await input.wait('选择 Arrange')
    assert.equal(input.registry.calls, 2)
    assert.deepEqual(input.framework.calls, [version])
    input.choose(version)
    await input.wait('确认使用')
    input.choose(true)
    await input.running
    assert.equal(input.result()!.version, version)
})

test('重试只处理暂时无法验证项，保留成功与确定拒绝结果，确认否不再联网', async t => {
    const input = fixture(t)
    input.registry.versions = [metadata('1.0.1'), metadata('1.0.2'), metadata('1.0.3')]
    let unavailable = true
    input.framework.validate = async version => {
        if (version === '1.0.2' && unavailable) throw new SourceUnavailableError('Git 超时')
        if (version === '1.0.3') throw new SourceTagMissingError('source', 'v1.0.3')
        return verified(version)
    }
    await input.wait('部分 Framework')
    unavailable = false
    input.choose('retry')
    await input.wait('选择 Arrange')
    assert.deepEqual(input.framework.calls, ['1.0.1', '1.0.2', '1.0.3', '1.0.2'])
    input.choose('1.0.2')
    await input.wait('确认使用')
    input.choose(false)
    await input.wait('选择 Arrange')
    assert.equal(input.current().initial, '1.0.2')
    assert.equal(input.framework.calls.length, 4)
    input.choose('1.0.2')
    await input.wait('确认使用')
    input.choose(true)
    await input.running
    assert.equal(input.result()!.version, '1.0.2')
})

test('查看结果后可从列表重试，刷新重新读取并验证，已有自定义版本保持且去重', async t => {
    const input = fixture(t)
    let unavailable = true
    input.framework.validate = async selected => {
        if (unavailable) throw new SourceUnavailableError('暂时断网')
        return verified(selected)
    }
    await input.wait('部分 Framework')
    input.choose('view-results')
    await input.wait('选择 Arrange')
    unavailable = false
    input.choose('retry')
    await input.wait('选择 Arrange')
    input.choose('custom')
    await input.wait('自定义 Arrange')
    input.paste('2.0.0')
    input.key('enter')
    await input.wait('选择 Arrange')
    assert.equal(input.current().initial, '2.0.0')
    assert.equal(input.result(), undefined)
    input.choose('custom')
    await input.wait('自定义 Arrange')
    input.paste('2.0.0')
    input.key('enter')
    await input.wait('选择 Arrange')
    assert.equal(input.current().options!.filter(option => option.value === '2.0.0').length, 1)
    assert.deepEqual(input.framework.customCalls, ['2.0.0'])
    input.choose('refresh')
    await input.wait('选择 Arrange')
    assert.equal(input.registry.calls, 2)
    assert.deepEqual(input.framework.customCalls, ['2.0.0', '2.0.0'])
    input.choose('2.0.0')
    await input.wait('确认使用')
    input.choose(true)
    await input.running
    assert.equal(input.result()!.version, '2.0.0')
})

test('自定义失败允许重试、修改或回列表，失败版本始终不可选', async t => {
    const input = fixture(t)
    let customAvailable = false
    input.framework.validate = async selected => {
        if (selected === '2.0.0' && !customAvailable) throw new RegistryUnreachableError('registry', '网络暂时失败')
        if (selected === '9.9.9') throw new Error('HTTP 404')
        return verified(selected)
    }
    await input.wait('选择 Arrange')
    input.choose('custom')
    await input.wait('自定义 Arrange')
    input.paste('9.9.9')
    input.key('enter')
    await input.wait('未通过验证')
    input.choose('back')
    await input.wait('选择 Arrange')
    assert.equal(input.current().options!.find(option => option.value === '9.9.9')!.disabled, true)
    input.choose('custom')
    await input.wait('自定义 Arrange')
    input.paste('9.9.9')
    input.key('enter')
    await input.wait('未通过验证')
    input.choose('edit')
    await input.wait('自定义 Arrange')
    input.paste('2.0.0')
    input.key('enter')
    await input.wait('未通过验证')
    customAvailable = true
    input.choose('retry')
    await input.wait('选择 Arrange')
    assert.equal(input.current().initial, '2.0.0')
    input.choose('2.0.0')
    await input.wait('确认使用')
    input.choose(true)
    await input.running
    assert.equal(input.result()!.version, '2.0.0')
})

for (const stage of ['列表', '读取失败', '候选暂时失败', '自定义失败', '确认'] as const) test(`${stage}取消统一结束选择，不返回版本`, async t => {
    const input = fixture(t)
    if (stage === '读取失败') input.registry.load = async () => { throw new RegistryUnreachableError('registry', '断网') }
    if (stage === '候选暂时失败') input.framework.validate = async () => { throw new SourceUnavailableError('断网') }
    if (stage === '读取失败') await input.wait('无法读取')
    else if (stage === '候选暂时失败') await input.wait('部分 Framework')
    else {
        await input.wait('选择 Arrange')
        if (stage === '确认') {
            input.choose(version)
            await input.wait('确认使用')
        } else if (stage === '自定义失败') {
            input.framework.validate = async () => { throw new Error('不存在') }
            input.choose('custom')
            await input.wait('自定义 Arrange')
            input.paste('9.9.9')
            input.key('enter')
            await input.wait('未通过验证')
        }
    }
    input.controller.cancel()
    await input.running
    assert.ok(input.failure() instanceof PromptCancelled)
    assert.equal(input.result(), undefined)
})

test('刷新失败保留已有结果和自定义版本，重试刷新后列表仍需最终确认', async t => {
    const input = fixture(t)
    await input.wait('选择 Arrange')
    input.choose('custom')
    await input.wait('自定义 Arrange')
    input.paste('2.0.0')
    input.key('enter')
    await input.wait('选择 Arrange')
    input.registry.load = async () => { throw new RegistryUnreachableError('registry', '暂时离线') }
    input.choose('refresh')
    await input.wait('无法读取')
    const calls = input.framework.calls.length
    input.registry.load = async () => [metadata(version), metadata('2.0.0')]
    input.choose('retry')
    await input.wait('选择 Arrange')
    assert.equal(input.current().options!.filter(option => option.value === '2.0.0').length, 1)
    assert.equal(input.current().initial, '2.0.0')
    assert.equal(input.framework.calls.length, calls + 2)
    assert.equal(input.result(), undefined)
    input.choose('2.0.0')
    await input.wait('确认使用')
    input.choose(true)
    await input.running
    assert.equal(input.result()!.version, '2.0.0')
})

test('所有版本确定不可用时不默认接受，仍允许自定义、刷新和取消', async t => {
    const input = fixture(t)
    input.registry.versions = [metadata(version, null)]
    await input.wait('选择 Arrange')
    assert.equal(input.current().options![0].disabled, true)
    input.key('home')
    input.key('enter')
    await input.wait('自定义 Arrange')
    assert.equal(input.result(), undefined)
    input.controller.cancel()
    await input.running
    assert.ok(input.failure() instanceof PromptCancelled)
})

test('候选验证取消先等所有在途验证完成，不展示列表或打开重试问题', async t => {
    const input = fixture(t)
    input.registry.versions = [metadata('1.0.1'), metadata('1.0.2'), metadata('1.0.3')]
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const bothStarted = new Promise<void>(resolve => { started = resolve })
    input.framework.validate = async selected => {
        if (selected === '1.0.1') {
            await gate
            throw new DOMException('已取消', 'AbortError')
        }
        started()
        await gate
        await delay(15)
        throw new DOMException('已取消', 'AbortError')
    }
    await bothStarted
    release()
    await input.running
    assert.equal((input.failure() as Error).name, 'AbortError')
    assert.equal(input.framework.inFlight, 0)
    assert.deepEqual(input.framework.calls, ['1.0.1', '1.0.2'])
    assert.deepEqual(input.questions, [])
})
