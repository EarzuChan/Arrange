import assert from 'node:assert/strict'
import test from 'node:test'
import { ConsoleBuffer } from '../src/terminal/ConsoleBuffer.ts'
import { stripAnsi } from '../src/util/TerminalText.ts'
import { setTimeout as delay } from 'node:timers/promises'

test('ANSI 解析、回车清行、颜色与所有输出行保留，解析结束后只剩视图内容', async () => {
    let lines: string[] = []
    const buffer = new ConsoleBuffer(value => { lines = value })
    buffer.write('building 10%\r\x1b[2Kbuilding 80%\r\n\x1b[32mok\x1b[0m\r\n')
    buffer.write(Array.from({ length: 40 }, (_, index) => '行 ' + index + '\r\n').join(''))
    await buffer.finish()
    const plain = lines.map(stripAnsi)
    assert.equal(plain[0], 'building 80%')
    assert.equal(plain[1], 'ok')
    assert.ok(lines[1]!.includes('38;5;2m'))
    for (let index = 0; index < 40; index++) assert.ok(plain.includes('行 ' + index))
    assert.throws(() => buffer.write('晚到'), /结束/)
    await buffer.finish()
})

test('各控制台隔离且长原行不会按宿主视口软换行', async () => {
    let first: string[] = [], second: string[] = []
    const one = new ConsoleBuffer(value => { first = value }), two = new ConsoleBuffer(value => { second = value })
    one.write('中😀'.repeat(2000) + '\r\n')
    two.write('另一个\r\n')
    await Promise.all([one.finish(), two.finish()])
    assert.ok(stripAnsi(first[0]!) === '中😀'.repeat(2000), '原行完整保留')
    assert.equal(stripAnsi(second[0]!), '另一个')
})

test('光标覆盖与清屏由解析器解释，离屏和清屏前内容仍保留在同一历史', async () => {
    let lines: string[] = []
    const buffer = new ConsoleBuffer(value => { lines = value })
    buffer.write('一\r\n二\r\n三\x1b[1A\r\x1b[2K改写二')
    await delay(25)
    assert.deepEqual(lines.map(stripAnsi).slice(0, 3), ['一', '改写二', '三'])
    buffer.write('\x1b[2J\x1b[H清屏后\r\n')
    await buffer.finish()
    assert.deepEqual(lines.map(stripAnsi).filter(Boolean), ['一', '改写二', '三', '清屏后'])
})

test('两万行大量分块输出完整有序，不用终端滚动上限截断会话历史', async () => {
    let lines: string[] = []
    const buffer = new ConsoleBuffer(value => { lines = value })
    for (let index = 0; index < 20000; index++) buffer.write('长输出 ' + index + '\r\n')
    await buffer.finish()
    const plain = lines.map(stripAnsi)
    assert.equal(plain.length, 20000)
    for (let index = 0; index < plain.length; index++) assert.equal(plain[index], '长输出 ' + index)
})
