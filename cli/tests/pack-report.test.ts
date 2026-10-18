import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { describePackResult } from "../src/business/report/PackReport.ts"
import type { PackResult } from "../src/feature/packing/Packer.ts"
import type { ProjectState } from "../src/feature/project/ProjectState.ts"
import { formatFileSize } from "../src/util/FileSize.ts"

test("打包报告列出目录、各产品位置、二进制大小与清单，路径相对工程根", async t => {
    const root = await mkdtemp(resolve(tmpdir(), "arrange-pack-report-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const directory = resolve(root, "artifacts", "release", "1.0.0", "products")
    await mkdir(resolve(directory, "standalone"), { recursive: true })
    const exe = resolve(directory, "standalone", "payload.bin")
    await writeFile(exe, Buffer.alloc(3 * 1000 * 1000))
    const result: PackResult = {
        directory,
        manifestPath: resolve(directory, "arrange-package.json"),
        products: [
            { product: "standalone", path: exe, binaryPath: exe, uiPath: resolve(directory, "standalone", "ui") },
            { product: "vst3", path: resolve(directory, "vst3", "App.vst3"), binaryPath: resolve(directory, "vst3", "App.vst3", "missing.vst3"), uiPath: resolve(directory, "vst3", "ui") },
        ],
    }
    const state = { rootDir: root, project: { project: { version: "1.0.0" } } } as unknown as ProjectState
    const lines = await describePackResult(state, "release", result)
    const at = (...parts: string[]) => join("artifacts", "release", "1.0.0", "products", ...parts)
    assert.deepEqual(lines, [
        `交付物（release · 1.0.0）：${at()}`,
        `standalone  ${at("standalone", "payload.bin")}，二进制 3 MB`,
        `vst3        ${at("vst3", "App.vst3")}`,
        `清单        ${at("arrange-package.json")}`,
    ])
})

test("文件大小自动进位至 GB 和 TB，舍入跨单位时不显示 1000 KB", () => {
    assert.equal(formatFileSize(987265696), "987.3 MB")
    assert.equal(formatFileSize(999950), "1 MB")
    assert.equal(formatFileSize(2000000000), "2 GB")
    assert.equal(formatFileSize(1500000000000), "1.5 TB")
    assert.equal(formatFileSize(0), "0 B")
})

test("交付目录在工程根之外时显示绝对路径", async () => {
    const state = { rootDir: resolve(tmpdir(), "arrange-pack-report-root"), project: { project: { version: "2.0.0" } } } as unknown as ProjectState
    const directory = resolve(tmpdir(), "arrange-pack-report-elsewhere")
    const lines = await describePackResult(state, "debug", { directory, manifestPath: resolve(directory, "arrange-package.json"), products: [] })
    assert.equal(lines[0], `交付物（debug · 2.0.0）：${directory}`)
})
