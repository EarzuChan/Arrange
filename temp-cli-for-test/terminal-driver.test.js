import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { TerminalDriver } from './tui/terminal-driver.ts'
import { protocol } from './tui/protocol.js'

class Input extends EventEmitter {
    isTTY = true
    isRaw = false
    readableFlowing = false
    rawCalls = []
    setRawMode(raw) {
        this.rawCalls.push(raw)
        this.isRaw = raw
    }
    pause() { this.readableFlowing = false }
    resume() { this.readableFlowing = true }
}

class Output extends Writable {
    isTTY = true
    columns = 80
    rows = 24
    chunks = []
    hold
    pending
    fail
    _write(chunk, encoding, callback) {
        const text = String(chunk)
        this.chunks.push(text)
        if (this.fail?.(text)) callback(new Error('写出失败'))
        else if (this.hold?.(text)) this.pending = callback
        else callback()
    }
    release() {
        const callback = this.pending
        this.pending = undefined
        callback()
    }
}

function fixture(options = {}) {
    const input = new Input(), output = new Output(), host = new EventEmitter()
    const driver = new TerminalDriver({ input, output, host, settleDelay: 0, ...options })
    return { input, output, host, driver }
}

test('唯一所有者成对恢复模式、原始输入状态与监听器', async () => {
    for (const raw of [false, true]) {
        const { input, output, host, driver } = fixture()
        input.isRaw = raw
        input.readableFlowing = raw
        const beforeExit = () => { }
        host.on('exit', beforeExit)
        driver.enter()
        assert.equal(input.isRaw, true)
        assert.equal(output.chunks[0], protocol.enter)
        assert.throws(() => new TerminalDriver({ input, output, host }).enter(), /接管/)
        assert.throws(() => driver.enter(), /重复/)
        const first = driver.close('历史\n\n')
        assert.strictEqual(driver.close('不得再次写出'), first)
        await first
        assert.deepEqual(output.chunks, [protocol.enter, protocol.stopReports, protocol.leave, '历史\r\n\r\n'])
        assert.equal(input.isRaw, raw)
        assert.equal(input.readableFlowing, raw)
        assert.deepEqual(input.eventNames(), [])
        assert.equal(output.listenerCount('resize'), 0)
        assert.equal(output.listenerCount('error'), 0)
        assert.deepEqual(host.eventNames(), ['exit'])
        assert.strictEqual(host.listeners('exit')[0], beforeExit)
        const next = new TerminalDriver({ input, output, host, settleDelay: 0 })
        next.enter()
        await next.close()
    }
})

test('输入、滚轮、缩放、取消与信号共用同一生命周期', async () => {
    const { input, output, host, driver } = fixture({ escapeDelay: 5 })
    const events = [], signals = []
    let resizes = 0
    driver.on('input', event => events.push(event))
    driver.on('resize', () => resizes++)
    driver.on('signal', signal => signals.push(signal))
    driver.enter()
    input.emit('data', Buffer.from('中\x1b[<64;4;8M\x1b'))
    await delay(15)
    host.emit('SIGINT')
    host.emit('SIGTERM')
    output.columns = 12
    output.rows = 4
    output.emit('resize')
    assert.deepEqual(events, [
        { kind: 'key', key: 'text', text: '中' }, { kind: 'wheel', x: 3, y: 7, delta: -1 },
        { kind: 'key', key: 'escape' }, { kind: 'key', key: 'interrupt' },
    ])
    assert.deepEqual(signals, ['SIGTERM'])
    assert.equal(resizes, 1)
    assert.equal(driver.columns, 12)
    assert.equal(driver.rows, 4)
    await driver.close()
    input.emit('data', Buffer.from('stray'))
    output.emit('resize')
    assert.equal(events.length, 4)
    assert.equal(resizes, 1)
})

test('慢输出合并帧并等待最终历史写出回调', async () => {
    const { output, driver } = fixture()
    output.hold = text => text.startsWith('frame') || text === 'transcript\r\n\r\n'
    driver.enter()
    driver.writeFrame('frame-1')
    driver.writeFrame('frame-2')
    driver.writeFrame('frame-3')
    assert.deepEqual(output.chunks, [protocol.enter, 'frame-1'])
    output.release()
    await turn()
    assert.deepEqual(output.chunks, [protocol.enter, 'frame-1', 'frame-3'])
    driver.writeFrame('frame-4')
    let complete = false
    const closed = driver.close('transcript\n\n').then(() => { complete = true })
    assert.equal(driver.state, 'closing')
    assert.equal(complete, false)
    output.release()
    await turn()
    assert.equal(output.chunks.includes('frame-4'), false)
    assert.equal(output.chunks.at(-2), protocol.leave)
    assert.equal(output.chunks.at(-1), 'transcript\r\n\r\n')
    assert.equal(driver.state, 'closing')
    output.release()
    await closed
    assert.equal(complete, true)
    assert.equal(driver.state, 'closed')
})

test('关闭时保持原始模式并丢弃迟到的终端报告', async () => {
    const { input, output, driver } = fixture({ settleDelay: 10 })
    const events = []
    driver.on('input', event => events.push(event))
    driver.enter()
    const closed = driver.close('done\n\n')
    await turn()
    assert.equal(input.isRaw, true)
    assert.equal(output.chunks.at(-1), protocol.stopReports)
    input.emit('data', Buffer.from('\x1b[<64;1;1M\r'))
    await closed
    assert.deepEqual(events, [])
    assert.equal(input.isRaw, false)
})

test('部分初始化失败仍恢复已取得的模式并释放所有权', async () => {
    const { input, output, host, driver } = fixture()
    const write = output.write.bind(output)
    output.write = (text, ...args) => {
        if (text === protocol.enter) throw new Error('初始化失败')
        return write(text, ...args)
    }
    assert.throws(() => driver.enter(), /初始化失败/)
    assert.equal(input.isRaw, false)
    assert.equal(driver.state, 'closed')
    assert.deepEqual(input.eventNames(), [])
    assert.deepEqual(host.eventNames(), [])
    assert.equal(output.chunks.at(-1), protocol.stopReports + protocol.leave)
    output.write = write
    const next = new TerminalDriver({ input, output, host, settleDelay: 0 })
    next.enter()
    await next.close()
})

test('原始模式恢复失败后继续清理并报告错误', async () => {
    const { input, output, driver } = fixture()
    driver.enter()
    input.setRawMode = () => { throw new Error('原始模式恢复失败') }
    await assert.rejects(driver.close('history\n\n'), /恢复/)
    assert.ok(output.chunks.includes(protocol.leave))
    assert.ok(output.chunks.includes('history\r\n\r\n'))
    assert.equal(driver.state, 'closed')
})

test('报告输出错误后仍归还输入所有权', async () => {
    const { input, output, driver } = fixture()
    driver.on('failure', () => { })
    driver.enter()
    output.fail = text => text === 'broken-frame'
    driver.writeFrame('broken-frame')
    await turn()
    await assert.rejects(driver.close('history'), /恢复/)
    assert.equal(input.isRaw, false)
    assert.equal(driver.state, 'closed')
    await turn()
})

test('进程退出执行幂等同步恢复且不关闭共享流', () => {
    const { input, output, host, driver } = fixture()
    driver.enter()
    host.emit('exit', 1)
    assert.equal(driver.state, 'closed')
    assert.equal(input.isRaw, false)
    assert.equal(output.destroyed, false)
    const count = output.chunks.length
    assert.deepEqual(driver.restoreSync(), [])
    assert.equal(output.chunks.length, count)
})

test('非 TTY 调用在修改流或注册进程监听前失败', () => {
    const { input, output, host, driver } = fixture()
    input.isTTY = false
    assert.throws(() => driver.enter(), /TTY/)
    assert.deepEqual(output.chunks, [])
    assert.deepEqual(host.eventNames(), [])
    assert.deepEqual(input.rawCalls, [])
})
