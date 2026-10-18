import assert from 'node:assert/strict'
import test from 'node:test'
import { InputDecoder } from './tui/input-decoder.ts'

test('UTF-8 和 VT 输入在任意字节分包后保持原义', () => {
    const source = Buffer.from('中😀é\x1b[A\x1bOB\x1b[5~\x1b[6~\x1b[1;5H\x1b[F\t\x1b[Z\r\n\x7f\x03')
    const expected = [
        { kind: 'key', key: 'text', text: '中' }, { kind: 'key', key: 'text', text: '😀' },
        { kind: 'key', key: 'text', text: 'e' }, { kind: 'key', key: 'text', text: '́' },
        { kind: 'key', key: 'up' }, { kind: 'key', key: 'down' },
        { kind: 'key', key: 'pageup' }, { kind: 'key', key: 'pagedown' },
        { kind: 'key', key: 'home', shift: false, alt: false, ctrl: true },
        { kind: 'key', key: 'end' }, { kind: 'key', key: 'tab' },
        { kind: 'key', key: 'backtab', shift: true, alt: false, ctrl: false },
        { kind: 'key', key: 'enter' }, { kind: 'key', key: 'backspace' }, { kind: 'key', key: 'interrupt' },
    ]
    for (let split = 0; split <= source.length; split++) {
        const decoder = new InputDecoder()
        assert.deepEqual([...decoder.feed(source.subarray(0, split)), ...decoder.feed(source.subarray(split))], expected, `分包位置 ${split}`)
    }
    const decoder = new InputDecoder()
    assert.deepEqual([...source].flatMap(byte => decoder.feed(Buffer.from([byte]))), expected)
})

test('SGR 鼠标报告使用零基单元格并区分滚轮、按下和释放', () => {
    const source = '\x1b[<64;4;8M\x1b[<65;80;24M\x1b[<0;5;9M\x1b[<0;5;9m'
    const expected = [
        { kind: 'wheel', x: 3, y: 7, delta: -1 }, { kind: 'wheel', x: 79, y: 23, delta: 1 },
        { kind: 'pointer', x: 4, y: 8, button: 0, action: 'press' },
        { kind: 'pointer', x: 4, y: 8, button: 0, action: 'release' },
    ]
    const decoder = new InputDecoder()
    assert.deepEqual([...source].flatMap(char => decoder.feed(char)), expected)
    assert.deepEqual(decoder.feed('\x1b[<64;0;1M\x1b[<64;1;0M\x1b[<64;99999999999999999;1M\x1b[<66;1;1M'), [])
})

test('括号粘贴保留为单个数据事件，内嵌回车、取消和中断不触发操作', () => {
    const source = Buffer.from('\x1b[200~你好\r\n\x03\x1b[A😀\x1b[201~x')
    const expected = [{ kind: 'paste', text: '你好\r\n\x03\x1b[A😀' }, { kind: 'key', key: 'text', text: 'x' }]
    for (let split = 0; split <= source.length; split++) {
        const decoder = new InputDecoder()
        const first = decoder.feed(source.subarray(0, split))
        assert.deepEqual([...first, ...decoder.feed(source.subarray(split))], expected)
    }
    const decoder = new InputDecoder({ maxPasteLength: 5 })
    decoder.feed('\x1b[200~12345')
    assert.equal(decoder.pending, false)
    assert.throws(() => decoder.feed('6'), /上限/)
    const exact = new InputDecoder({ maxPasteLength: 5 })
    assert.deepEqual(exact.feed('\x1b[200~12345\x1b[20'), [])
    assert.deepEqual(exact.feed('1~'), [{ kind: 'paste', text: '12345' }])
})

test('单独 Escape 超时生效，完整序列及终端应答不混入文本', () => {
    const decoder = new InputDecoder()
    assert.deepEqual(decoder.feed('\x1b'), [])
    assert.equal(decoder.pending, true)
    assert.deepEqual(decoder.expire(), [{ kind: 'key', key: 'escape' }])
    assert.deepEqual(decoder.feed('\x1b['), [])
    assert.deepEqual(decoder.expire(), [])
    assert.deepEqual(decoder.feed('\x1b[12;9R\x1b[?1;2c\x1b[99~\x1b]title'), [])
    assert.equal(decoder.pending, false)
    assert.deepEqual(decoder.feed('\x1b'), [])
    assert.deepEqual(decoder.feed('\\z'), [{ kind: 'key', key: 'text', text: 'z' }])
    assert.deepEqual(decoder.feed('\x1bPignored\x07n'), [{ kind: 'key', key: 'text', text: 'n' }])
})
