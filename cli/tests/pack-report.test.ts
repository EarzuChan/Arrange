import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { describePackResult } from "../src/packing/PackReport.ts"
import type { PackResult } from "../src/packing/Packer.ts"
import type { ProjectState } from "../src/project/ProjectState.ts"

test("打包报告列出目录、各产品位置、二进制大小与清单，路径相对工程根", async t => {
    const root = await mkdtemp(resolve(tmpdir(), "arrange-pack-report-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const directory = resolve(root, "artifacts", "release", "1.0.0", "windows-x64")
    await mkdir(resolve(directory, "standalone"), { recursive: true })
    const exe = resolve(directory, "standalone", "App.exe")
    await writeFile(exe, Buffer.alloc(3 * 1024 * 1024))
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
    const at = (...parts: string[]) => join("artifacts", "release", "1.0.0", "windows-x64", ...parts)
    assert.deepEqual(lines, [
        `交付物（release · 1.0.0）：${at()}`,
        `standalone  ${at("standalone", "App.exe")}，二进制 3.0 MB`,
        `vst3        ${at("vst3", "App.vst3")}`,
        `清单        ${at("arrange-package.json")}`,
    ])
})

test("交付目录在工程根之外时显示绝对路径", async () => {
    const state = { rootDir: resolve(tmpdir(), "arrange-pack-report-root"), project: { project: { version: "2.0.0" } } } as unknown as ProjectState
    const directory = resolve(tmpdir(), "arrange-pack-report-elsewhere")
    const lines = await describePackResult(state, "debug", { directory, manifestPath: resolve(directory, "arrange-package.json"), products: [] })
    assert.equal(lines[0], `交付物（debug · 2.0.0）：${directory}`)
})
