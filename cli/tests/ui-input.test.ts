import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { InputParser, TerminalInput, type InputEvent } from "../src/ui/Input.ts"
import { ConsoleInput } from "../src/ui/ConsoleInput.ts"

test("按键：方向、翻页、Home/End（含 CSI、SS3 与 ~ 写法）、Tab、Shift+Tab、回车、Ctrl+C", () => {
    const parser = new InputParser()
    const keys = parser.feed("\x1b[A\x1b[B\x1b[5~\x1b[6~\x1b[H\x1b[F\x1b[1~\x1b[4~\x1bOH\x1bOF\t\x1b[Z\r\x03\x1b[1;5A").map(event => event.kind === "key" ? event.key : event.kind)
    assert.deepEqual(keys, ["up", "down", "pageup", "pagedown", "home", "end", "home", "end", "home", "end", "tab", "backtab", "enter", "interrupt", "up"])
})

test("SGR 鼠标：滚轮上下带坐标，左键按下为点击，释放与移动忽略", () => {
    const parser = new InputParser()
    assert.deepEqual(parser.feed("\x1b[<64;10;5M\x1b[<65;12;7M\x1b[<0;3;4M\x1b[<0;3;4m\x1b[<35;1;1M\x1b[<68;2;2M"), [
        { kind: "wheel", direction: "up", column: 10, row: 5 },
        { kind: "wheel", direction: "down", column: 12, row: 7 },
        { kind: "click", column: 3, row: 4 },
        { kind: "wheel", direction: "up", column: 2, row: 2 },
    ])
})

test("被拆开的转义序列等到完整才解析；单独的 ESC 超时后才算 Esc 键", () => {
    const parser = new InputParser()
    assert.deepEqual(parser.feed("\x1b[<6"), [])
    assert.ok(parser.pending)
    assert.deepEqual(parser.feed("4;10;5M"), [{ kind: "wheel", direction: "up", column: 10, row: 5 }])
    assert.deepEqual(parser.feed("\x1b"), [])
    assert.deepEqual(parser.flush(), [{ kind: "key", key: "escape" }])
})

test("光标位置应答只在发出查询后识别，否则不误判为按键", () => {
    const parser = new InputParser()
    assert.deepEqual(parser.feed("\x1b[12;1R"), [])
    parser.expectCursorReport()
    assert.deepEqual(parser.feed("\x1b[12;1R"), [{ kind: "cursor", row: 12, column: 1 }])
    assert.deepEqual(parser.feed("\x1b[13;1R"), [])
})

test("普通字符（含中文）作为字符事件", () => {
    assert.deepEqual(new InputParser().feed("g中"), [{ kind: "key", key: "char", text: "g" }, { kind: "key", key: "char", text: "中" }])
})

class FakeStdin extends EventEmitter {
    readonly isTTY = true
    raw = false
    paused = true
    readonly modes: boolean[] = []
    setRawMode(mode: boolean): this {
        this.raw = mode
        this.modes.push(mode)
        return this
    }
    resume(): this {
        this.paused = false
        return this
    }
    pause(): this {
        this.paused = true
        return this
    }
}

function consoleOn(stdin: FakeStdin) {
    let interrupts = 0
    const input = new ConsoleInput(stdin as unknown as NodeJS.ReadStream, () => interrupts++)
    return { input, interrupts: () => interrupts }
}

test("任务会话输入：接管控制台输入并开启鼠标上报，Ctrl+C 交给控制台输入转成中断，结束后交还并关闭鼠标上报", () => {
    const stdin = new FakeStdin()
    const { input: console, interrupts } = consoleOn(stdin)
    const written: string[] = []
    const events: InputEvent[] = []
    const session = new TerminalInput(console, sequence => written.push(sequence), event => events.push(event))
    assert.equal(session.start(), true)
    assert.equal(stdin.raw, true)
    assert.equal(stdin.paused, false)
    assert.match(written.join(""), /\x1b\[\?1000h\x1b\[\?1006h/)
    stdin.emit("data", Buffer.from("\x1b[<65;1;1M\x03"))
    assert.deepEqual(events, [{ kind: "wheel", direction: "down", column: 1, row: 1 }])
    assert.equal(interrupts(), 1)
    session.queryCursor()
    assert.ok(written.includes("\x1b[6n"))
    stdin.emit("data", "\x1b[20;1R")
    assert.deepEqual(events.at(-1), { kind: "cursor", row: 20, column: 1 })
    session.stop()
    assert.match(written.join(""), /\x1b\[\?1006l\x1b\[\?1000l/)
    // 会话结束不切换终端模式：原始模式保持到控制台输入关闭
    assert.equal(stdin.raw, true)
    stdin.emit("data", "x")
    assert.equal(events.length, 2, "会话结束后输入不再进入会话")
    console.close()
    assert.equal(stdin.raw, false)
    assert.equal(stdin.paused, true)
    assert.equal(stdin.listenerCount("data"), 0)
    assert.deepEqual(stdin.modes, [true, false], "整个过程只进入一次原始模式、退出一次")
})

test("控制台输入：提问读取代理流时才接管终端；代理流只在提问进行中收到输入，空闲时只响应 Ctrl+C", async () => {
    const stdin = new FakeStdin()
    const { input: console, interrupts } = consoleOn(stdin)
    assert.deepEqual(stdin.modes, [], "尚未需要输入时不接管终端")
    const received: string[] = []
    const onData = (chunk: Buffer): void => { received.push(chunk.toString()) }
    console.prompt.on("data", onData)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(stdin.raw, true, "提问开始读取后进入原始模式")
    stdin.emit("data", "y\r")
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(received, ["y\r"])
    // 提问结束：代理流暂停，并模拟 clack 关闭时的模式切换，真实终端不受影响
    console.prompt.setRawMode(false)
    console.prompt.pause()
    console.prompt.off("data", onData)
    assert.equal(stdin.raw, true)
    stdin.emit("data", "typed while idle")
    assert.deepEqual(received, ["y\r"], "空闲时的键入不会留给下一个提问")
    stdin.emit("data", "\x03")
    assert.equal(interrupts(), 1)
    assert.deepEqual(stdin.modes, [true])
    console.close()
})

