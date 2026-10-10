import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { test, type TestContext } from "node:test"
import { join, resolve, sep } from "node:path"
import { PNG } from "pngjs"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { windowsBuildPathTailBudget, windowsExternalSourceTailBudget, windowsMaxPathLength } from "../src/CliMetadata.ts"
import { CmakeService, windowsBuildPathProblem, windowsTailBudget } from "../src/cmake/CmakeService.ts"
import { Executor } from "../src/platform/Executor.ts"
import { MacPlatformService } from "../src/platform/MacPlatformService.ts"
import { WindowsPlatformService } from "../src/platform/WindowsPlatformService.ts"
import type { ProjectState } from "../src/project/ProjectState.ts"
import { fixture } from "./fixture.ts"

function services() {
    const executor = new Executor()
    const icons = new IconAssetsService()
    return { windows: new CmakeService(executor, new WindowsPlatformService(executor), icons), mac: new CmakeService(executor, new MacPlatformService(executor), icons) }
}

async function localAppData(t: TestContext, value: string): Promise<void> {
    const previous = process.env["LOCALAPPDATA"]
    t.after(() => {
        if (previous === undefined) delete process.env["LOCALAPPDATA"]
        else process.env["LOCALAPPDATA"] = previous
    })
    process.env["LOCALAPPDATA"] = value
}

function withNative(state: ProjectState, architecture: "x64" | "arm64", buildRoot?: string): void {
    state.local = { native: { generator: "Ninja", architecture, ...(buildRoot ? { buildRoot } : {}) } }
}

test("Windows 构建树位于 LOCALAPPDATA 下的短哈希目录，与工程路径长度无关", async t => {
    await localAppData(t, resolve("/tmp-local-app-data"))
    const { windows } = services()
    const state = await fixture(t, false)
    withNative(state, "x64")
    const digest = createHash("sha256").update(resolve(state.rootDir).toLowerCase()).digest("hex").slice(0, 8)
    const base = join(resolve("/tmp-local-app-data"), "Arrange", "b", digest)
    assert.equal(windows.buildDirectory(state, "debug"), join(base, "xd"))
    assert.equal(windows.buildDirectory(state, "release"), join(base, "xr"))
    withNative(state, "arm64")
    assert.equal(windows.buildDirectory(state, "debug"), join(base, "ad"))
    assert.equal(windows.buildDirectory(state, "release"), join(base, "ar"))
    assert.equal(windows.buildDirectory(state, "debug").startsWith(state.rootDir), false)
})

test("Windows 构建目录由工程根唯一确定：同根相同，异根不同，大小写不敏感", async t => {
    await localAppData(t, resolve("/tmp-local-app-data"))
    const { windows } = services()
    const first = await fixture(t, false)
    const second = await fixture(t, false)
    withNative(first, "x64")
    withNative(second, "x64")
    assert.notEqual(windows.buildDirectory(first, "debug"), windows.buildDirectory(second, "debug"))
    const upper = { ...first, rootDir: first.rootDir.toUpperCase() }
    assert.equal(windows.buildDirectory(upper, "debug"), windows.buildDirectory(first, "debug"))
})

test("native.buildRoot 覆盖默认的 LOCALAPPDATA 位置", async t => {
    await localAppData(t, resolve("/tmp-local-app-data"))
    const { windows } = services()
    const state = await fixture(t, false)
    withNative(state, "x64", resolve("/short-root"))
    assert.equal(windows.buildDirectory(state, "release").startsWith(resolve("/short-root") + sep), true)
})

test("macOS 构建树仍在工程内的 .arrange/build", async t => {
    const { mac } = services()
    const state = await fixture(t, false)
    withNative(state, "arm64")
    assert.equal(mac.buildDirectory(state, "debug"), join(state.rootDir, ".arrange", "build", "mac-arm64", "debug"))
})

test("Windows 路径预检：最坏对象文件路径不超过 259 字符，超限给出明确指引", () => {
    const limit = windowsMaxPathLength - windowsBuildPathTailBudget - 1
    assert.equal(windowsBuildPathProblem("C".repeat(limit)), undefined)
    const message = windowsBuildPathProblem("C".repeat(limit + 1))
    assert.ok(message)
    assert.match(message, /native\.buildRoot/)
    assert.match(message, new RegExp(`不超过 ${limit} 个字符`))
})

test("使用外部 JUCE 源码时预检采用更大的尾部预算（对象路径内嵌源码绝对路径）", () => {
    assert.equal(windowsTailBudget(undefined), windowsBuildPathTailBudget)
    assert.equal(windowsTailBudget({ ARRANGE_OTHER: "1" }), windowsBuildPathTailBudget)
    assert.equal(windowsTailBudget({ JUCE_DIR: "E:/juce" }), windowsExternalSourceTailBudget)
    assert.equal(windowsTailBudget({ FETCHCONTENT_SOURCE_DIR_JUCE: "E:/juce" }), windowsExternalSourceTailBudget)
    const limit = windowsMaxPathLength - windowsExternalSourceTailBudget - 1
    assert.equal(windowsBuildPathProblem("C".repeat(limit), windowsExternalSourceTailBudget), undefined)
    assert.match(windowsBuildPathProblem("C".repeat(limit + 1), windowsExternalSourceTailBudget)!, new RegExp(`不超过 ${limit} 个字符`))
})

test("构建树在工程外时，图标派生按构建锚点包含检查；默认以工程根为基准仍会拒绝", async t => {
    const state = await fixture(t, false)
    state.project.project.icon = "assets/icon.png"
    const image = new PNG({ width: 256, height: 256 })
    image.data.fill(200)
    await mkdir(join(state.rootDir, "assets"))
    await writeFile(join(state.rootDir, "assets", "icon.png"), PNG.sync.write(image))
    const anchor = await mkdtemp(join(tmpdir(), "arrange-external-build-"))
    t.after(() => rm(anchor, { recursive: true, force: true }))
    const directory = join(anchor, "hash", "xr", "icon")
    const icons = new IconAssetsService()
    await assert.rejects(icons.prepare(state, directory), /必须位于/)
    const prepared = await icons.prepare(state, directory, anchor)
    assert.ok(prepared)
    await access(prepared.ico)
    assert.equal((await icons.inspect(state, directory, anchor)).ready, true)
})

test("默认构建目录在常见与较长的用户名下都留有路径余量", async t => {
    const { windows } = services()
    const state = await fixture(t, false)
    withNative(state, "x64")
    for (const user of ["a", "Earzu Chan", "A Very Long User Name 20"]) {
        await localAppData(t, `C:\\Users\\${user}\\AppData\\Local`)
        const directory = windows.buildDirectory(state, "release")
        assert.equal(windowsBuildPathProblem(directory), undefined, `${user}: ${directory.length}`)
    }
})
