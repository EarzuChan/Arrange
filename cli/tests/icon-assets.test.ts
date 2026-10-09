import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { PNG } from "pngjs"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { resizeIcon } from "../src/asset/IconResize.ts"
import { loadPngIconSource, loadProjectIconSource } from "../src/asset/PngIcon.ts"
import { Executor } from "../src/platform/Executor.ts"
import { toolProbeTimeoutMs } from "../src/CliMetadata.ts"
import { stateFor } from "./fixture.ts"

function pngBytes(size: number, pixel: (x: number, y: number) => readonly number[] = () => [255, 255, 255, 128], height = size): Buffer {
    const image = new PNG({ width: size, height })
    for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) image.data.set(pixel(x, y), (y * size + x) * 4)
    return PNG.sync.write(image)
}

async function iconFixture(t: TestContext, size = 256, bytes = pngBytes(size)) {
    const root = await mkdtemp(join(tmpdir(), "arrange-icon-test-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const state = stateFor(root)
    state.project.project.icon = "assets/source icon.png"
    const source = join(root, state.project.project.icon)
    await mkdir(join(root, "assets"))
    await writeFile(source, bytes)
    const output = join(root, ".arrange/build/generated/icon")
    const service = new IconAssetsService()
    return { root, state, source, output, service }
}

function readIco(bytes: Buffer): { size: number, pixels: Buffer, kind: "png" | "dib" }[] {
    assert.equal(bytes.readUInt16LE(0), 0)
    assert.equal(bytes.readUInt16LE(2), 1)
    const count = bytes.readUInt16LE(4)
    const images = []
    let expectedOffset = 6 + count * 16
    for (let index = 0; index < count; index++) {
        const entry = 6 + index * 16
        const size = bytes[entry] || 256
        assert.equal(bytes[entry + 1] || 256, size)
        assert.equal(bytes.readUInt16LE(entry + 4), 1)
        assert.equal(bytes.readUInt16LE(entry + 6), 32)
        const length = bytes.readUInt32LE(entry + 8)
        const offset = bytes.readUInt32LE(entry + 12)
        assert.equal(offset, expectedOffset)
        assert.ok(offset + length <= bytes.length)
        const content = bytes.subarray(offset, offset + length)
        if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
            const decoded = PNG.sync.read(content)
            assert.equal(decoded.width, size)
            assert.equal(decoded.height, size)
            images.push({ size, pixels: decoded.data, kind: "png" as const })
        } else {
            assert.equal(content.readUInt32LE(0), 40)
            assert.equal(content.readInt32LE(4), size)
            assert.equal(content.readInt32LE(8), size * 2)
            assert.equal(content.readUInt16LE(12), 1)
            assert.equal(content.readUInt16LE(14), 32)
            assert.equal(content.readUInt32LE(16), 0)
            const pixels = Buffer.alloc(size * size * 4)
            const maskStride = Math.ceil(size / 32) * 4
            assert.equal(content.length, 40 + pixels.length + maskStride * size)
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const source = 40 + ((size - 1 - y) * size + x) * 4
                const destination = (y * size + x) * 4
                pixels.set([content[source + 2], content[source + 1], content[source], content[source + 3]], destination)
                const mask = content[40 + pixels.length + (size - 1 - y) * maskStride + Math.floor(x / 8)] & (0x80 >> (x % 8))
                assert.equal(Boolean(mask), content[source + 3] === 0)
            }
            images.push({ size, pixels, kind: "dib" as const })
        }
        expectedOffset += length
    }
    assert.equal(expectedOffset, bytes.length)
    return images
}

function readIcns(bytes: Buffer): { type: string, size: number, pixels: Buffer, png: Buffer }[] {
    assert.equal(bytes.toString("ascii", 0, 4), "icns")
    assert.equal(bytes.readUInt32BE(4), bytes.length)
    const images = []
    let offset = 8
    while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset + 4)
        assert.ok(length > 8 && offset + length <= bytes.length)
        const png = bytes.subarray(offset + 8, offset + length)
        const type = bytes.toString("ascii", offset, offset + 4)
        if (type === "ic04" || type === "ic05") {
            assert.equal(png.toString("ascii", 0, 4), "ARGB")
            const size = type === "ic04" ? 16 : 32
            const pixels = Buffer.alloc(size * size * 4)
            let cursor = 4
            for (const channel of [3, 0, 1, 2]) {
                let decoded = 0
                while (decoded < size * size) {
                    const control = png[cursor++]
                    const count = control <= 127 ? control + 1 : control - 125
                    assert.ok(decoded + count <= size * size)
                    if (control <= 127) for (let index = 0; index < count; index++) pixels[(decoded++ * 4) + channel] = png[cursor++]
                    else {
                        const value = png[cursor++]
                        for (let index = 0; index < count; index++) pixels[(decoded++ * 4) + channel] = value
                    }
                }
            }
            assert.equal(cursor, png.length)
            images.push({ type, size, pixels, png })
        } else {
            const decoded = PNG.sync.read(png)
            assert.equal(decoded.width, decoded.height)
            images.push({ type, size: decoded.width, pixels: decoded.data, png })
        }
        offset += length
    }
    assert.equal(offset, bytes.length)
    assert.equal(new Set(images.map(image => image.type)).size, images.length)
    return images
}

test("外部 PNG 校验提供原始 bytes/内容摘要，工程根相对来源保留 alpha", async t => {
    const input = await iconFixture(t)
    const source = await loadPngIconSource(input.source)
    assert.equal(source.size, 256)
    assert.equal(source.path, input.source)
    assert.equal(source.fingerprint, createHash("sha256").update(source.bytes).digest("hex"))
    assert.deepEqual(source.bytes, await readFile(input.source))
    assert.equal(PNG.sync.read(source.bytes).data[3], 128)
    assert.deepEqual(await loadProjectIconSource(input.state), source)
})

test("PNG 签名/CRC/截断/结束结构损坏均失败，不把可读取首帧的 APNG 当静态图", async t => {
    const input = await iconFixture(t)
    const original = await readFile(input.source)
    const corrupt = Buffer.from(original)
    corrupt[29] ^= 1
    const chunk = (type: string) => {
        const result = Buffer.alloc(12)
        result.write(type, 4, "ascii")
        return Buffer.concat([original.subarray(0, 33), result, original.subarray(33)])
    }
    const variants = [
        Buffer.from("不是 PNG"), original.subarray(0, original.length - 5), corrupt,
        Buffer.concat([original.subarray(0, 33), original.subarray(8, 33), original.subarray(33)]),
        Buffer.concat([original, Buffer.from("额外数据")]), original.subarray(0, original.length - 12),
        ...["acTL", "fcTL", "fdAT"].map(chunk),
    ]
    for (const [index, bytes] of variants.entries()) {
        await writeFile(input.source, bytes)
        await assert.rejects(loadPngIconSource(input.source), /PNG|APNG/, `变体 ${index} 应失败`)
    }
})

test("源图至少 256、必须正方形；超大 IHDR 在分配像素前拒绝", async t => {
    const input = await iconFixture(t)
    for (const bytes of [pngBytes(128), pngBytes(256, undefined, 128)]) {
        await writeFile(input.source, bytes)
        await assert.rejects(loadPngIconSource(input.source), /至少.*256.*正方形/)
    }
    const largeHeader = pngBytes(256)
    largeHeader.writeUInt32BE(65536, 16)
    largeHeader.writeUInt32BE(65536, 20)
    await writeFile(input.source, largeHeader)
    await assert.rejects(loadPngIconSource(input.source), /像素总数/)
})

test("ICO 真实目录/32位 DIB/256 PNG 均可解码，方向、透明 AND mask 与 alpha 正确", async t => {
    const input = await iconFixture(t, 256, pngBytes(256, (x, y) => [x, y, 40, x < 64 ? 0 : y < 128 ? 128 : 255]))
    const assets = (await input.service.prepare(input.state, input.output))!
    const images = readIco(await readFile(assets.ico))
    assert.deepEqual(images.map(image => image.size), [16, 24, 32, 48, 64, 128, 256])
    assert.deepEqual(images.map(image => image.kind), ["dib", "dib", "dib", "dib", "dib", "dib", "png"])
    assert.deepEqual(images.at(-1)!.pixels, PNG.sync.read(await readFile(input.source)).data)
    const small = images.find(image => image.size === 32)!
    const top = (8 * 32 + 24) * 4
    const bottom = (24 * 32 + 24) * 4
    assert.ok(small.pixels[top + 1] < small.pixels[bottom + 1])
    assert.equal(small.pixels[top + 3], 128)
    assert.equal(small.pixels[bottom + 3], 255)
})

test("1024 源图 ICNS 提供全部十个标准/Retina 槽位，同像素尺寸共用一致图像", async t => {
    const input = await iconFixture(t, 1024)
    const assets = (await input.service.prepare(input.state, input.output))!
    const images = readIcns(await readFile(assets.icns))
    assert.deepEqual(images.map(({ type, size }) => [type, size]), [["ic04", 16], ["ic11", 32], ["ic05", 32], ["ic12", 64], ["ic07", 128], ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024]])
    assert.deepEqual(images.find(image => image.type === "ic11")!.pixels, images.find(image => image.type === "ic05")!.pixels)
    assert.deepEqual(images.find(image => image.type === "ic13")!.png, images.find(image => image.type === "ic08")!.png)
    assert.deepEqual(images.find(image => image.type === "ic14")!.png, images.find(image => image.type === "ic09")!.png)
    for (const image of images) for (let index = 3; index < image.pixels.length; index += 4) assert.equal(image.pixels[index], 128)
})

test("非标准源尺寸不放大、不裁切，低分辨率 ICNS 不伪造高分辨率槽位", async t => {
    const input = await iconFixture(t, 300)
    const assets = (await input.service.prepare(input.state, input.output))!
    const images = readIcns(await readFile(assets.icns))
    assert.deepEqual(images.map(({ type, size }) => [type, size]), [["ic04", 16], ["ic11", 32], ["ic05", 32], ["ic12", 64], ["ic07", 128], ["ic13", 256], ["ic08", 256]])
    assert.equal(assets.size, 300)
    assert.ok(images.every(image => image.size <= 300))
})

test("macOS 系统解码 ICNS 后小尺寸标准/Retina 图像均保留透明与半透明边缘", { skip: process.platform !== "darwin" }, async t => {
    const input = await iconFixture(t, 256, pngBytes(256, (x, y) => (x - 128) ** 2 + (y - 128) ** 2 < 80 ** 2 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const assets = (await input.service.prepare(input.state, input.output))!
    const iconset = join(input.root, "decoded.iconset")
    const result = await new Executor().run({ command: "/usr/bin/iconutil", args: ["-c", "iconset", "-o", iconset, assets.icns], timeoutMs: toolProbeTimeoutMs })
    assert.equal(result.exitCode, 0, result.stderr)
    const files = await readdir(iconset)
    assert.deepEqual(files.sort(), ["icon_128x128.png", "icon_128x128@2x.png", "icon_16x16.png", "icon_16x16@2x.png", "icon_256x256.png", "icon_32x32.png", "icon_32x32@2x.png"].sort())
    for (const file of files) {
        const image = PNG.sync.read(await readFile(join(iconset, file)))
        assert.ok(image.data.some((value, index) => index % 4 === 3 && value === 0), `${file} 透明像素`)
        if (image.width < 256) assert.ok(image.data.some((value, index) => index % 4 === 3 && value > 0 && value < 255), `${file} 半透明像素`)
        for (let index = 0; index < image.data.length; index += 4) if (image.data[index + 3] > 0) assert.ok(image.data[index] >= 254 && image.data[index + 1] >= 254 && image.data[index + 2] >= 254, `${file} 透明边缘不黑化`)
    }
})

test("预乘 alpha 缩放不会混入透明区域隐藏黑色；高频颜色缩小保持线性光平均", async t => {
    const input = await iconFixture(t, 256, pngBytes(256, (x, y) => (x - 128) ** 2 + (y - 128) ** 2 < 80 ** 2 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const assets = (await input.service.prepare(input.state, input.output))!
    for (const image of readIco(await readFile(assets.ico)).slice(0, -1)) {
        let partial = 0
        for (let index = 0; index < image.pixels.length; index += 4) if (image.pixels[index + 3] > 0 && image.pixels[index + 3] < 255) {
            partial++
            assert.deepEqual([...image.pixels.subarray(index, index + 3)], [255, 255, 255])
        }
        assert.ok(partial > 0)
    }
    const checker = PNG.sync.read(pngBytes(64, (x, y) => (x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
    const average = resizeIcon({ size: 64, data: checker.data }, 8)
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) {
        const pixel = (y * 8 + x) * 4
        assert.ok(average.data[pixel] >= 186 && average.data[pixel] <= 189)
        assert.equal(average.data[pixel + 3], 255)
    }
    assert.throws(() => resizeIcon({ size: 64, data: checker.data }, 65), /不得大于源图/)
    assert.deepEqual(resizeIcon({ size: 64, data: checker.data }, 64).data, checker.data)
})

test("同路径内容变化与派生资源篡改可检查为过期，prepare重建且已准备时不重写", async t => {
    const input = await iconFixture(t)
    const missing = await input.service.inspect(input.state, input.output)
    assert.equal(missing.ready, false)
    const first = (await input.service.prepare(input.state, input.output))!
    const originalIco = await readFile(first.ico)
    const originalStat = await stat(first.ico, { bigint: true })
    assert.equal((await input.service.inspect(input.state, input.output)).ready, true)
    assert.deepEqual(await input.service.prepare(input.state, input.output), first)
    assert.equal((await stat(first.ico, { bigint: true })).mtimeNs, originalStat.mtimeNs)
    await writeFile(first.icns, "已损坏")
    assert.match((await input.service.inspect(input.state, input.output)).reason!, /派生资源已变化/)
    await input.service.prepare(input.state, input.output)
    assert.deepEqual(await readFile(first.ico), originalIco)
    await writeFile(input.source, pngBytes(256, () => [200, 30, 70, 255]))
    assert.match((await input.service.inspect(input.state, input.output)).reason!, /源内容已变化/)
    const changed = (await input.service.prepare(input.state, input.output))!
    assert.notEqual(changed.fingerprint, first.fingerprint)
    assert.notDeepEqual(await readFile(changed.ico), originalIco)
    assert.equal((await input.service.inspect(input.state, input.output)).ready, true)
    await writeFile(join(input.output, "icon.json"), "无法解析")
    assert.match((await input.service.inspect(input.state, input.output)).reason!, /记录损坏/)
})

test("移除 icon 清理三个旧派生文件，保留源图和未知额外文件；纯inspect无副作用", async t => {
    const input = await iconFixture(t)
    const assets = (await input.service.prepare(input.state, input.output))!
    const unknown = join(input.output, "user-extra.txt")
    await writeFile(unknown, "用户文件")
    delete input.state.project.project.icon
    assert.equal((await input.service.inspect(input.state, input.output)).ready, false)
    assert.ok(await readFile(assets.ico))
    assert.equal(await input.service.prepare(input.state, input.output), null)
    for (const name of ["icon.ico", "icon.icns", "icon.json"]) await assert.rejects(readFile(join(input.output, name)), { code: "ENOENT" })
    assert.equal(await readFile(unknown, "utf8"), "用户文件")
    assert.ok(await readFile(input.source))
    assert.deepEqual(await input.service.inspect(input.state, input.output), { source: null, assets: null, ready: true })
})

test("root相对源路径不能逃逸或经过文件/父目录符号链接", async t => {
    const input = await iconFixture(t)
    for (const value of ["../outside.png", input.source, "C:\\outside\\icon.png", "C:icon.png", ""]) {
        input.state.project.project.icon = value
        await assert.rejects(loadProjectIconSource(input.state), /相对|工程根/)
    }
    await symlink(input.source, join(input.root, "assets/link.png"))
    input.state.project.project.icon = "assets/link.png"
    await assert.rejects(loadProjectIconSource(input.state), /符号链接/)
    await symlink(join(input.root, "assets"), join(input.root, "linked-assets"), "dir")
    input.state.project.project.icon = "linked-assets/source icon.png"
    await assert.rejects(loadProjectIconSource(input.state), /符号链接/)
})

test("派生输出拒绝root/外部/链接目录与已知文件别名；失败不改外部文件", async t => {
    const input = await iconFixture(t)
    const outside = await mkdtemp(join(tmpdir(), "arrange-icon-outside-"))
    t.after(() => rm(outside, { recursive: true, force: true }))
    const sentinel = join(outside, "sentinel")
    await writeFile(sentinel, "不可更改")
    for (const output of [input.root, outside]) await assert.rejects(input.service.prepare(input.state, output), /独立子目录/)
    await symlink(outside, join(input.root, "output-link"), "dir")
    await assert.rejects(input.service.prepare(input.state, join(input.root, "output-link/icon")), /符号链接/)
    await mkdir(input.output, { recursive: true })
    await symlink(sentinel, join(input.output, "icon.ico"))
    await assert.rejects(input.service.prepare(input.state, input.output), /普通文件/)
    delete input.state.project.project.icon
    await assert.rejects(input.service.prepare(input.state, input.output), /普通文件/)
    assert.equal(await readFile(sentinel, "utf8"), "不可更改")
})

test("坏源图不会先覆盖旧派生，提前取消没有写入，源目录不能同时作为派生目录", async t => {
    const input = await iconFixture(t)
    const assets = (await input.service.prepare(input.state, input.output))!
    const original = await readFile(assets.ico)
    await assert.rejects(input.service.prepare(input.state, join(input.root, "assets")), /不能包含图标源/)
    await writeFile(input.source, "坏源")
    await assert.rejects(input.service.prepare(input.state, input.output), /PNG/)
    assert.deepEqual(await readFile(assets.ico), original)
    const controller = new AbortController()
    controller.abort()
    const cancelled = new IconAssetsService(controller.signal)
    const output = join(input.root, "uncreated/icon")
    await assert.rejects(cancelled.prepare(input.state, output), { name: "AbortError" })
    await assert.rejects(stat(output), { code: "ENOENT" })
})
