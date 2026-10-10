import assert from "node:assert/strict"
import test from "node:test"
import { Screen, type LiveView } from "../src/ui/Screen.ts"
import { EmulatedTty } from "./terminal-emulator.ts"

class ScriptedView implements LiveView {
    lines: string[] = []
    render(): string[] { return this.lines }
}

function region(prefix: string, count: number, width = 20): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}${index}`.padEnd(width, "."))
}

test("实时区域反复变高变矮、上方插入持久输出，卸下后滚动历史里只有持久内容且顺序正确", async () => {
    const tty = new EmulatedTty(40, 12)
    const screen = new Screen(tty, tty)
    const view = new ScriptedView()
    screen.print(["before 1", "before 2"])
    screen.mount(view)
    const expected = ["before 1", "before 2"]
    for (let step = 0; step < 30; step++) {
        view.lines = region(`r${step}-`, (step * 7) % 6 + 1)
        screen.renderNow()
        if (step % 4 === 0) {
            screen.print(`log ${step}`)
            expected.push(`log ${step}`)
        }
    }
    screen.unmount(["final"])
    expected.push("final")
    assert.deepEqual(await tty.lines(), expected)
    assert.ok(tty.written.join("").endsWith("\x1b[?25h\x1b[?2026l"), "卸下时恢复光标")
})

test("内容多于屏幕时只画最后若干行，不把旧帧挤进滚动历史", async () => {
    const tty = new EmulatedTty(30, 8)
    const screen = new Screen(tty, tty)
    const view = new ScriptedView()
    screen.mount(view)
    for (let step = 0; step < 5; step++) {
        view.lines = region(`s${step}-`, 20, 10)
        screen.renderNow()
    }
    assert.equal((await tty.screen()).filter(line => line.startsWith("s4-")).length, 7)
    screen.unmount()
    assert.deepEqual(await tty.lines(), [])
})

test("中文与满宽的行不触发终端自动折行，擦除时行数计算准确", async () => {
    const tty = new EmulatedTty(20, 10)
    const screen = new Screen(tty, tty)
    const view = new ScriptedView()
    screen.mount(view)
    for (let step = 0; step < 10; step++) {
        view.lines = [`中文中文中文中文中文${step}`, "x".repeat(40), `第${step}帧`]
        screen.renderNow()
    }
    screen.unmount(["结束"])
    assert.deepEqual(await tty.lines(), ["结束"])
})

test("窗口缩窄后终端重排旧帧（光标行不重排的 xterm.js 规则下），重绘仍能完整擦除旧区域", async () => {
    const tty = new EmulatedTty(60, 15)
    const screen = new Screen(tty, tty)
    const view = new ScriptedView()
    screen.print("head")
    screen.mount(view)
    view.lines = region("wide-", 4, 58)
    screen.renderNow()
    await tty.resize(40, 15)
    view.lines = region("narrow-", 3, 30)
    screen.renderNow()
    screen.print("middle")
    await tty.resize(70, 15)
    view.lines = region("again-", 4, 60)
    screen.renderNow()
    await tty.resize(31, 15)
    screen.unmount(["tail"])
    assert.deepEqual(await tty.lines(), ["head", "middle", "tail"])
})

// 固有边界：缩窄后重排出的区域高于整个屏幕时，溢出部分已被终端推进滚动历史，程序无法再擦除；只残留溢出的那几行
test("缩窄到重排后高于屏幕时，只有被终端推进滚动历史的部分残留", async () => {
    const tty = new EmulatedTty(60, 15)
    const screen = new Screen(tty, tty)
    const view = new ScriptedView()
    screen.print("head")
    screen.mount(view)
    view.lines = region("wide-", 5, 58)
    screen.renderNow()
    await tty.resize(25, 15)
    screen.unmount(["tail"])
    const lines = await tty.lines()
    assert.equal(lines[0], "head")
    assert.equal(lines.at(-1), "tail")
    assert.ok(lines.length <= 3, `残留不超过溢出的行数：${JSON.stringify(lines)}`)
})

test("行数与列数不变时只重写变化的行，屏幕始终等于最新一帧", async () => {
    const tty = new EmulatedTty(50, 20)
    const screen = new Screen(tty, tty)
    const view = new ScriptedView()
    screen.mount(view)
    const base = region("row-", 8, 30)
    view.lines = [...base]
    screen.renderNow()
    for (let step = 0; step < 20; step++) {
        view.lines = base.map((line, index) => index === step % 8 ? `改动 ${step} 中文`.padEnd(20, "~") : index === (step + 3) % 8 ? "" : line)
        const before = tty.written.length
        screen.renderNow()
        const bytes = tty.written.slice(before).join("").length
        assert.ok(bytes < 200, `两行变化只写出少量字节：${bytes}`)
        const visible = (await tty.screen()).filter(line => line !== "")
        assert.deepEqual(visible, view.lines.filter(line => line !== ""))
    }
    view.lines = region("grow-", 10, 30)
    screen.renderNow()
    assert.deepEqual((await tty.screen()).filter(line => line !== ""), view.lines)
    screen.print("插入")
    view.lines = region("after-", 3, 30)
    screen.renderNow()
    screen.unmount(["结束"])
    assert.deepEqual(await tty.lines(), ["插入", "结束"])
})

test("非 TTY 时不绘制实时区域，持久输出按流分开写", async () => {
    const out: string[] = []
    const err: string[] = []
    const stream = (sink: string[]) => ({
        isTTY: false, write: (chunk: string) => {
            sink.push(chunk)
            return true
        }
    }) as unknown as NodeJS.WritableStream
    const screen = new Screen(stream(out), stream(err))
    const view = new ScriptedView()
    view.lines = ["live"]
    screen.mount(view)
    screen.renderNow()
    screen.print("info")
    screen.print("bad", "stderr")
    screen.unmount(["done"])
    assert.deepEqual(out, ["info\n", "done\n"])
    assert.deepEqual(err, ["bad\n"])
})
