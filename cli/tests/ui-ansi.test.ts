import assert from "node:assert/strict"
import test from "node:test"
import { fit, padEnd, sanitizeLine, stripAnsi, truncate, visibleWidth, wrap } from "../src/util/TerminalText.ts"

const red = "\x1b[31m"
const bold = "\x1b[1m"
const reset = "\x1b[0m"

test("可见宽度：中日韩字符两列、颜色序列零宽、制表符等控制序列不计", () => {
    assert.equal(visibleWidth("abc"), 3)
    assert.equal(visibleWidth("中文"), 4)
    assert.equal(visibleWidth(`${red}错误${reset} x`), 6)
    assert.equal(visibleWidth("“找不到标识符”"), 14)
    assert.equal(visibleWidth("e\u0301"), 1)
})

test("折行按可见列硬断开，中文不跨行拆开，颜色在下一行重新打开且每行行尾复位", () => {
    assert.deepEqual(wrap("abcdefgh", 3), ["abc", "def", "gh"])
    assert.deepEqual(wrap("中文中文", 3), ["中", "文", "中", "文"])
    assert.deepEqual(wrap("a中文", 4), ["a中", "文"])
    assert.deepEqual(wrap("", 5), [""])
    const rows = wrap(`${red}abcdef${reset}gh`, 4)
    assert.deepEqual(rows.map(stripAnsi), ["abcd", "efgh"])
    assert.equal(rows[0], `${red}abcd${reset}`)
    assert.ok(rows[1]!.startsWith(red), "第二行重新打开颜色")
    // 复合 SGR 与 0; 开头的重置组合都能正确延续
    const compound = wrap(`\x1b[0;1;31mabcdef`, 3)
    assert.equal(compound[1], `\x1b[0;1;31mdef${reset}`)
    const nested = wrap(`${bold}${red}abcd${reset}`, 2)
    assert.equal(nested[1], `${bold}${red}cd${reset}`)
    for (const row of wrap("长行：C:\\Users\\某人\\AppData\\Local\\Arrange\\b\\feddfd43\\xd\\_deps\\quickjs_ng-src\\quickjs.c(75): warning C4668", 17)) assert.ok(visibleWidth(row) <= 17)
})

test("截断保留颜色并以省略号结尾，宽度恰好时不截断", () => {
    assert.equal(truncate("abcdef", 6), "abcdef")
    assert.equal(truncate("abcdef", 4), "abc…")
    assert.equal(truncate("中文中文", 5), "中文…")
    assert.equal(truncate(`${red}abcdef`, 4), `${red}abc${reset}…`)
    assert.equal(visibleWidth(truncate("中文中文中文", 7)), 7)
    assert.equal(truncate("abc", 0), "")
})

test("补齐与适配按可见宽度计算", () => {
    assert.equal(padEnd("中", 4), "中  ")
    assert.equal(fit("中文中文", 5), "中文…")
    assert.equal(visibleWidth(fit(`${red}a`, 3)), 3)
})

test("清洗子进程输出：保留颜色，去掉光标移动、清屏、标题与控制字符，制表符按列展开", () => {
    assert.equal(sanitizeLine(`${red}error${reset}`), `${red}error${reset}`)
    assert.equal(sanitizeLine("\x1b[2K\x1b[1Gdone"), "done")
    assert.equal(sanitizeLine("\x1b]0;title\x07text"), "text")
    assert.equal(sanitizeLine("a\x07b\x00c\x08d"), "abcd")
    assert.equal(sanitizeLine("a\tb"), "a       b")
    assert.equal(sanitizeLine("中\tb"), "中      b")
    assert.equal(sanitizeLine("\x1b[?25lhidden\x1b[?25h"), "hidden")
})
