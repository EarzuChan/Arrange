import assert from "node:assert/strict"
import test from "node:test"
import { LogBuffer, LogViewport } from "../src/ui/LogView.ts"

function filled(count: number, capacity?: number): LogBuffer {
    const buffer = new LogBuffer(capacity)
    for (let index = 0; index < count; index++) buffer.append(`line ${index}`)
    return buffer
}

test("环形缓冲超过容量时丢弃最旧的行，行号持续递增", () => {
    const buffer = filled(7, 5)
    assert.equal(buffer.firstSeq, 2)
    assert.equal(buffer.nextSeq, 7)
    assert.equal(buffer.dropped, 2)
    assert.equal(buffer.line(2), "line 2")
    assert.equal(buffer.line(6), "line 6")
    assert.throws(() => buffer.line(1), RangeError)
    assert.deepEqual(buffer.tail(3), ["line 4", "line 5", "line 6"])
})

test("默认跟随末尾；内容不足一框时不留空行在上方", () => {
    const viewport = new LogViewport(filled(20))
    assert.deepEqual(viewport.window(40, 3), { rows: ["line 17", "line 18", "line 19"], linesAbove: 17, linesBelow: 0, following: true })
    const short = new LogViewport(filled(2))
    assert.deepEqual(short.window(40, 5).rows, ["line 0", "line 1"])
})

test("向上滚动停止跟随且新日志到来时内容不动；滚回底部或 End 恢复跟随", () => {
    const buffer = filled(20)
    const viewport = new LogViewport(buffer)
    viewport.scroll(-5, 40, 3)
    let window = viewport.window(40, 3)
    assert.deepEqual(window.rows, ["line 12", "line 13", "line 14"])
    assert.equal(window.following, false)
    assert.equal(window.linesBelow, 5)
    buffer.append("line 20")
    window = viewport.window(40, 3)
    assert.deepEqual(window.rows, ["line 12", "line 13", "line 14"])
    assert.equal(window.linesBelow, 6)
    viewport.scroll(3, 40, 3)
    assert.deepEqual(viewport.window(40, 3).rows, ["line 15", "line 16", "line 17"])
    viewport.scroll(100, 40, 3)
    assert.equal(viewport.window(40, 3).following, true)
    viewport.scroll(-2, 40, 3)
    viewport.toBottom()
    assert.deepEqual(viewport.window(40, 3).rows, ["line 18", "line 19", "line 20"])
})

test("顶部为界；Home 跳到最早一行；内容放得下时不进入滚动", () => {
    const viewport = new LogViewport(filled(10))
    viewport.scroll(-100, 40, 3)
    assert.deepEqual(viewport.window(40, 3).rows, ["line 0", "line 1", "line 2"])
    viewport.toBottom()
    viewport.toTop(40, 3)
    assert.equal(viewport.window(40, 3).linesAbove, 0)
    const fits = new LogViewport(filled(3))
    fits.scroll(-1, 40, 5)
    assert.equal(fits.window(40, 5).following, true)
})

test("滚动以折行后的行为单位，长行可以逐行滚过", () => {
    const buffer = new LogBuffer()
    buffer.append("short")
    buffer.append("0123456789abcdefghij")
    buffer.append("tail")
    const viewport = new LogViewport(buffer)
    assert.deepEqual(viewport.window(5, 3).rows, ["abcde", "fghij", "tail"])
    viewport.scroll(-1, 5, 3)
    assert.deepEqual(viewport.window(5, 3).rows, ["56789", "abcde", "fghij"])
    viewport.scroll(-2, 5, 3)
    assert.deepEqual(viewport.window(5, 3).rows, ["short", "01234", "56789"])
})

test("未换行的当前输出作为最后一行显示", () => {
    const buffer = filled(3)
    buffer.partial = "Progress: resolved 87"
    assert.deepEqual(new LogViewport(buffer).window(40, 2).rows, ["line 2", "Progress: resolved 87"])
})

test("宽度变化后重新折行，不沿用旧宽度的缓存", () => {
    const buffer = new LogBuffer()
    buffer.append("0123456789")
    const viewport = new LogViewport(buffer)
    assert.deepEqual(viewport.window(5, 5).rows, ["01234", "56789"])
    assert.deepEqual(viewport.window(10, 5).rows, ["0123456789"])
})

test("丢弃最旧行后，停在已丢弃位置的视口回到现存最早一行", () => {
    const buffer = filled(10, 10)
    const viewport = new LogViewport(buffer)
    viewport.toTop(40, 3)
    for (let index = 10; index < 15; index++) buffer.append(`line ${index}`)
    assert.deepEqual(viewport.window(40, 3).rows, ["line 5", "line 6", "line 7"])
})
