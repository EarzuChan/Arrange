import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises'
import { TerminalDriver } from '../src/terminal/TerminalDriver.ts'
import { protocol } from '../src/terminal/Protocol.ts'

class Input extends EventEmitter {
    isTTY = true
    isRaw = false
    readableFlowing = false
    setRawMode(raw: boolean): void { this.isRaw = raw }
    resume(): void { this.readableFlowing = true }
    pause(): void { this.readableFlowing = false }
}
class Output extends Writable {
    isTTY = true
    columns = 80
    rows = 24
    readonly chunks: string[] = []
    hold?: (text: string) => boolean
    fail?: (text: string) => boolean
    pending?: (error?: Error | null) => void
    override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        const text = chunk.toString()
        this.chunks.push(text)
        if (this.fail?.(text)) callback(new Error('输出失败'))
        else if (this.hold?.(text)) this.pending = callback
        else callback()
    }
    release(): void {
        const callback = this.pending
        this.pending = undefined
        callback?.()
    }
}
function fixture(settleDelay = 0) {
    const input = new Input(), output = new Output(), host = new EventEmitter()
    const driver = new TerminalDriver({ input, output, host, settleDelay })
    return { input, output, host, driver }
}

test('唯一终端所有权、模式成对恢复、幂等关闭和全部监听释放', async () => {
    for (const raw of [false, true]) {
        const { input, output, host, driver } = fixture()
        input.isRaw = raw
        input.readableFlowing = raw
        driver.enter()
        assert.throws(() => new TerminalDriver({ input, output, host }).enter(), /接管/)
        const closing = driver.close('完整历史\n\n')
        assert.strictEqual(driver.close('不应再次输出'), closing)
        await closing
        assert.deepEqual(output.chunks, [protocol.enter, protocol.stopReports, protocol.leave, '完整历史\r\n\r\n'])
        assert.equal(input.isRaw, raw)
        assert.equal(input.readableFlowing, raw)
        assert.equal(output.destroyed, false)
        assert.deepEqual(host.eventNames(), [])
        assert.deepEqual(input.eventNames(), [])
        const next = new TerminalDriver({ input, output, host, settleDelay: 0 })
        next.enter()
        await next.close()
    }
})

test('输出背压只保留最新整帧，退出等在途帧及最终拍扁写回调', async () => {
    const { output, driver } = fixture()
    output.hold = text => text.startsWith('帧') || text.startsWith('历史')
    driver.enter()
    driver.writeFrame('帧一')
    driver.writeFrame('帧二')
    driver.writeFrame('帧三')
    assert.deepEqual(output.chunks, [protocol.enter, '帧一'])
    output.release()
    await turn()
    assert.deepEqual(output.chunks, [protocol.enter, '帧一', '帧三'])
    driver.writeFrame('帧四')
    let complete = false
    const closing = driver.close('历史\n\n').then(() => { complete = true })
    assert.equal(complete, false)
    output.release()
    await turn()
    assert.ok(!output.chunks.includes('帧四'))
    assert.equal(output.chunks.at(-2), protocol.leave)
    assert.equal(driver.state, 'closing')
    output.release()
    await closing
    assert.equal(complete, true)
})

test('退出交接在原始模式下丢弃迟到鼠标报告，再归还 shell 输入', async () => {
    const { input, driver } = fixture(10)
    const events: unknown[] = []
    driver.on('input', event => events.push(event))
    driver.enter()
    const closing = driver.close('完成\n\n')
    await turn()
    assert.equal(input.isRaw, true)
    input.emit('data', Buffer.from('\x1b[<64;1;1M\r'))
    await closing
    assert.deepEqual(events, [])
    assert.equal(input.isRaw, false)
})

test('部分初始化失败与原始模式恢复失败都继续归还其它模式', async () => {
    const { input, output, host, driver } = fixture()
    const write = output.write.bind(output)
    output.write = ((text: string, ...args: unknown[]) => {
        if (text === protocol.enter) throw new Error('初始化失败')
        return (write as (...args: unknown[]) => boolean)(text, ...args)
    }) as typeof output.write
    assert.throws(() => driver.enter(), /初始化失败/)
    assert.equal(input.isRaw, false)
    assert.deepEqual(host.eventNames(), [])
    output.write = write
    await driver.close('初始化失败的历史\n\n')
    assert.equal(output.chunks.at(-1), '初始化失败的历史\r\n\r\n')
    const next = new TerminalDriver({ input, output, host, settleDelay: 0 })
    next.enter()
    input.setRawMode = () => { throw new Error('恢复失败') }
    await assert.rejects(next.close('历史'), /恢复/)
    assert.ok(output.chunks.includes(protocol.leave))
    assert.ok(output.chunks.includes('历史'))
    assert.equal(next.state, 'closed')
})

test('输入与信号共用生命周期，输出失败及退出钩子不关闭系统流', async () => {
    const { input, output, host, driver } = fixture()
    const events: unknown[] = [], signals: string[] = []
    driver.on('input', event => events.push(event))
    driver.on('signal', signal => signals.push(signal))
    driver.on('failure', () => { })
    driver.enter()
    input.emit('data', Buffer.from('中'))
    host.emit('SIGINT')
    host.emit('SIGTERM')
    assert.deepEqual(signals, ['SIGTERM'])
    assert.equal(events.length, 2)
    output.fail = text => text === '故障帧'
    driver.writeFrame('故障帧')
    await delay(10)
    await assert.rejects(driver.close('历史'), /恢复/)
    assert.equal(input.isRaw, false)
    assert.equal(driver.state, 'closed')
    const second = fixture()
    second.driver.enter()
    second.host.emit('exit', 1)
    assert.equal(second.input.isRaw, false)
    assert.equal(second.output.destroyed, false)
    const count = second.output.chunks.length
    assert.deepEqual(second.driver.restoreSync(), [])
    assert.equal(second.output.chunks.length, count)
})
