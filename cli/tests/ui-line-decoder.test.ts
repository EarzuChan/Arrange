import assert from "node:assert/strict"
import test from "node:test"
import { codePageDecoder, decodeLineBytes, LineDecoder, overwriteCarriageReturns, parseCodePage } from "../src/ui/LineDecoder.ts"

// “找不到标识符” 的 GBK 编码（MSVC 在 936 代码页控制台下经管道输出的就是这种字节）
const gbkMessage = Buffer.from("a1b0d5d2b2bbb5bdb1eacab6b7fba1b1", "hex")
const gbk = (): TextDecoder => new TextDecoder("gbk")

function collect(fallback = gbk) {
    const lines: string[] = []
    return { lines, decoder: new LineDecoder(line => lines.push(line), fallback) }
}

test("按换行切行，去掉 CRLF 的回车；结尾无换行的行在 flush 时输出", () => {
    const { lines, decoder } = collect()
    decoder.push(Buffer.from("one\r\ntwo\nthree"))
    assert.deepEqual(lines, ["one", "two"])
    assert.equal(decoder.partial, "three")
    decoder.flush()
    assert.deepEqual(lines, ["one", "two", "three"])
    assert.equal(decoder.partial, undefined)
})

test("UTF-8 多字节字符被拆在两个数据块之间时仍正确解码", () => {
    const { lines, decoder } = collect()
    const bytes = Buffer.from("构建完成\n")
    decoder.push(bytes.subarray(0, 4))
    decoder.push(bytes.subarray(4))
    assert.deepEqual(lines, ["构建完成"])
})

test("非 UTF-8 的行按控制台代码页回退解码，同一流里 UTF-8 行不受影响", () => {
    const { lines, decoder } = collect()
    decoder.push(Buffer.concat([Buffer.from("bad.cpp(1): error C3861: "), gbkMessage, Buffer.from("\r\n-- UTF-8 行：完成\n")]))
    assert.deepEqual(lines, ["bad.cpp(1): error C3861: “找不到标识符”", "-- UTF-8 行：完成"])
})

test("行内回车表示覆盖刷新，只保留最后一段", () => {
    assert.equal(overwriteCarriageReturns("Progress 1\rProgress 2"), "Progress 2")
    assert.equal(overwriteCarriageReturns("done\r"), "done")
    assert.equal(decodeLineBytes(Buffer.from("10%\r50%\r100%"), gbk), "100%")
})

test("没有换行的超长输出按上限强制成行，不无限缓存", () => {
    const { lines, decoder } = collect()
    decoder.push(Buffer.alloc(70 * 1024, 0x61))
    assert.equal(lines.length, 1)
    assert.equal(lines[0]!.length, 70 * 1024)
})

test("代码页解析与映射：chcp 的本地化输出、常见代码页与未知代码页", () => {
    assert.equal(parseCodePage("活动代码页: 936\r\n"), 936)
    assert.equal(parseCodePage("Active code page: 65001\r\n"), 65001)
    assert.equal(parseCodePage("no number"), undefined)
    assert.equal(codePageDecoder(936).encoding, "gbk")
    assert.equal(codePageDecoder(65001).encoding, "utf-8")
    assert.equal(codePageDecoder(437).encoding, "windows-1252")
    assert.equal(codePageDecoder(undefined).encoding, "windows-1252")
})
