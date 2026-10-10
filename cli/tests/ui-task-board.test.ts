import assert from "node:assert/strict"
import test from "node:test"
import { stripAnsi, visibleWidth } from "../src/ui/Ansi.ts"
import { TaskBoard } from "../src/ui/TaskBoard.ts"
import { colorPalette, plainPalette } from "../src/ui/Theme.ts"

function board(now = 0) {
    let clock = now
    const instance = new TaskBoard(plainPalette, () => clock)
    return { board: instance, advance: (ms: number) => { clock += ms } }
}

test("每个运行中的任务一行标题加一个日志框，框内跟随最新输出，行宽不超过可用宽度", () => {
    const { board: view, advance } = board()
    const install = view.add({ id: "install-ui", title: "安装 UI 依赖", detail: "pnpm install" })
    const configure = view.add({ id: "configure-native-debug", title: "配置 native · debug", detail: "cmake" })
    for (let index = 0; index < 20; index++) view.append(install, `Progress: resolved ${index}`)
    view.append(configure, "-- Fetching JUCE 8.0.12")
    advance(12_300)
    const rows = view.render(70, 30).map(stripAnsi)
    for (const row of rows) assert.ok(visibleWidth(row) <= 70, row)
    const installHeader = rows.findIndex(row => row.includes("安装 UI 依赖 · pnpm install"))
    assert.ok(installHeader > 0)
    assert.match(rows[installHeader]!, /12s$/)
    assert.match(rows[installHeader + 1]!, /^│  ╭─+╮$/)
    // 框高 8 行：显示最后 8 行输出
    assert.match(rows[installHeader + 2]!, /│ Progress: resolved 12 +│$/)
    assert.match(rows[installHeader + 9]!, /│ Progress: resolved 19 +│$/)
    assert.match(rows[installHeader + 10]!, /╰─+ 20 行 ─╯$/)
    assert.ok(rows.some(row => row.includes("配置 native · debug · cmake")))
    assert.ok(rows.some(row => row.includes("-- Fetching JUCE 8.0.12")))
})

test("有进度时标题显示进度条与计数；框为空时提示等待输出", () => {
    const { board: view } = board()
    const build = view.add({ id: "build", title: "构建 native · release" })
    build.progress = { done: 86, total: 148 }
    build.stage = "编译"
    const rows = view.render(90, 20).map(stripAnsi)
    const header = rows.find(row => row.includes("构建 native · release"))!
    assert.match(header, /· 编译/)
    assert.match(header, /━+╸─+ {2}86\/148/)
    assert.ok(rows.some(row => row.includes("等待输出…")))
})

test("空间不够放框时退化为只显示标题行；任务过多时提示其余数量", () => {
    const { board: view } = board()
    for (let index = 0; index < 6; index++) view.add({ id: `t${index}`, title: `任务 ${index}` })
    const rows = view.render(60, 6).map(stripAnsi)
    assert.ok(rows.length <= 6)
    assert.ok(!rows.some(row => row.includes("╭")))
    assert.match(rows.at(-1)!, /还有 \d+ 个任务/)
})

test("键盘：方向键与翻页滚动焦点框，Tab 切换焦点，End 恢复跟随；滚动后边框提示上下未显示的行数", () => {
    const { board: view } = board()
    view.showHints = true
    const first = view.add({ id: "a", title: "A" })
    const second = view.add({ id: "b", title: "B" })
    for (let index = 0; index < 50; index++) view.append(first, `a${index}`)
    for (let index = 0; index < 50; index++) view.append(second, `b${index}`)
    view.render(60, 40)
    assert.equal(view.handle({ kind: "key", key: "pageup" }, undefined), true)
    let rows = view.render(60, 40).map(stripAnsi)
    assert.ok(rows.some(row => /↓ 7 行 · End 跟随/.test(row)), "A 框向上翻了一页")
    assert.ok(rows.some(row => /↑ 35 行/.test(row)))
    assert.equal(second.viewport.following, true)
    view.handle({ kind: "key", key: "tab" }, undefined)
    view.handle({ kind: "key", key: "up" }, undefined)
    assert.equal(second.viewport.following, false)
    view.handle({ kind: "key", key: "end" }, undefined)
    assert.equal(second.viewport.following, true)
    rows = view.render(60, 40).map(stripAnsi)
    assert.match(rows.at(-1)!, /滚轮.*Tab 切换.*Ctrl\+C 取消/)
})

test("滚轮按所在位置命中对应的框并把焦点移过去；位置未知时作用于焦点框", () => {
    const { board: view } = board()
    view.showHints = true
    const first = view.add({ id: "a", title: "A" })
    const second = view.add({ id: "b", title: "B" })
    for (let index = 0; index < 30; index++) {
        view.append(first, `a${index}`)
        view.append(second, `b${index}`)
    }
    const rows = view.render(60, 40).map(stripAnsi)
    view.handle({ kind: "wheel", direction: "up", column: 10, row: 1 }, undefined)
    assert.equal(first.viewport.following, false, "位置未知时作用于焦点框 A")
    view.handle({ kind: "key", key: "end" }, undefined)
    assert.equal(first.viewport.following, true)
    const secondRow = rows.findIndex(row => row.includes("b29"))
    // 区域首行在屏幕第 5 行：滚轮事件的行号 = 5 + 区域内偏移
    view.handle({ kind: "wheel", direction: "up", column: 10, row: 5 + secondRow }, 5)
    assert.equal(second.viewport.following, false)
    assert.equal(first.viewport.following, true)
    // 焦点随滚轮移到 B，End 作用于 B
    view.handle({ kind: "key", key: "end" }, undefined)
    assert.equal(second.viewport.following, true)
})

test("点击框把焦点移过去，焦点框边框高亮", () => {
    const { board: view } = board()
    view.showHints = true
    view.add({ id: "a", title: "A" })
    const second = view.add({ id: "b", title: "B" })
    view.append(second, "hello")
    const plain = view.render(60, 40).map(stripAnsi)
    const row = plain.findIndex(line => line.includes("hello"))
    assert.equal(view.handle({ kind: "click", column: 5, row: 1 + row }, 1), true)
    const colored = new TaskBoard(colorPalette)
    colored.showHints = true
    colored.add({ id: "a", title: "A" })
    colored.add({ id: "b", title: "B" })
    assert.ok(colored.render(60, 40).some(line => line.includes("\x1b[36m╭")), "焦点框以青色边框绘制")
})

test("任务结束摘要：成功一行带用时；失败带原因、日志末尾静态框与完整日志路径；取消单独标注", () => {
    const { board: view, advance } = board()
    const ok = view.add({ id: "ok", title: "安装 UI 依赖", detail: "pnpm install" })
    advance(3100)
    ok.status = "succeeded"
    ok.endedAt = 3100
    assert.deepEqual(view.summary(ok, 60).map(stripAnsi), ["│", "◇  安装 UI 依赖 · pnpm install  3.1s"])
    const failed = view.add({ id: "bad", title: "配置 native · debug" })
    for (let index = 0; index < 300; index++) view.append(failed, `line ${index}`)
    failed.status = "failed"
    failed.failure = "CMake configure 未成功（1）"
    failed.logPath = ".arrange/logs/x/configure-native-debug.log"
    const lines = view.summary(failed, 60).map(stripAnsi)
    assert.match(lines[1]!, /■  配置 native · debug 失败/)
    assert.equal(lines[2], "│  CMake configure 未成功（1）")
    assert.ok(lines.includes("│  │ line 299" + " ".repeat(60 - 3 - 4 - 8) + " │"))
    assert.ok(!lines.some(line => line.includes("line 99 ")), "只保留末尾 200 行")
    assert.match(lines.at(-2)!, /共 300 行 · 最后 200 行/)
    assert.equal(lines.at(-1), "│  完整日志：.arrange/logs/x/configure-native-debug.log")
    const cancelled = view.add({ id: "c", title: "构建 UI" })
    cancelled.status = "cancelled"
    assert.match(view.summary(cancelled, 60).map(stripAnsi)[1]!, /■  构建 UI 已取消/)
})

test("没有颜色的工具输出里，错误与警告行被着色；自带颜色的行保持原样", () => {
    const view = new TaskBoard(colorPalette)
    assert.equal(view.highlight("bad.cpp(1): error C3861: x"), "\x1b[31mbad.cpp(1): error C3861: x\x1b[39m")
    assert.match(view.highlight("dtoa.c(109): warning C4146"), /^\x1b\[33m/)
    assert.equal(view.highlight("\x1b[32mok\x1b[0m error"), "\x1b[32mok\x1b[0m error")
    assert.equal(view.highlight("[3/136] Building C object"), "[3/136] Building C object")
})
