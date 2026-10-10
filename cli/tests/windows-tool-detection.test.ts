import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseMsvcArchitecture, parseMsvcBanner } from "../src/platform/WindowsPlatformService.ts"
import { locateTool } from "../src/platform/ToolLocator.ts"

// cl.exe 横幅会随系统语言本地化；以下样本取自各语言的真实横幅形态，解析不得依赖其中的词
const banners = [
    ["英文", "Microsoft (R) C/C++ Optimizing Compiler Version 19.50.35728 for x64\r\nCopyright (C) Microsoft Corporation.  All rights reserved.\r\n\r\nusage: cl [ option... ] filename... [ /link linkoption... ]\r\n", "19.50.35728", "x64"],
    ["简体中文", "用于 x64 的 Microsoft (R) C/C++ 优化编译器 19.50.35728 版\r\n版权所有(C) Microsoft Corporation。保留所有权利。\r\n\r\n用法: cl [ 选项... ] 文件名... [ /link 链接选项... ]\r\n", "19.50.35728", "x64"],
    ["日文", "Microsoft (R) C/C++ Optimizing Compiler Version 19.50.35728 (x64 版)\r\nCopyright (C) Microsoft Corporation. All rights reserved.\r\n", "19.50.35728", "x64"],
    ["德文", "Microsoft (R) C/C++-Optimierungscompiler Version 19.44.35219 für ARM64\r\nCopyright (C) Microsoft Corporation. Alle Rechte vorbehalten.\r\n", "19.44.35219", "arm64"],
    ["横幅前有空行", "\r\n\r\n用于 ARM64 的 Microsoft (R) C/C++ 优化编译器 19.44.35219 版\r\n", "19.44.35219", "arm64"],
    // 真实运行：用法行在 stdout、横幅在 stderr，CLI 拼接为 `${stdout}\n${stderr}`，用法行排在横幅之前
    ["用法行在前（中文）", "用法: cl [ 选项... ] 文件名... [ /link 链接选项... ]\r\n\n用于 x64 的 Microsoft (R) C/C++ 优化编译器 19.50.35728 版\r\n版权所有(C) Microsoft Corporation。保留所有权利。\r\n\r\n", "19.50.35728", "x64"],
    ["用法行在前（英文）", "usage: cl [ option... ] filename... [ /link linkoption... ]\r\n\nMicrosoft (R) C/C++ Optimizing Compiler Version 19.50.35728 for x64\r\nCopyright (C) Microsoft Corporation.  All rights reserved.\r\n", "19.50.35728", "x64"],
] as const

for (const [label, banner, version, architecture] of banners) {
    test(`MSVC 横幅解析与语言无关：${label}`, () => {
        assert.deepEqual(parseMsvcBanner(banner), { version, architecture })
        assert.equal(parseMsvcArchitecture(banner), architecture)
    })
}

test("MSVC 横幅：x86 不是受支持的目标，缺少版本或架构时不臆测", () => {
    assert.equal(parseMsvcArchitecture("用于 x86 的 Microsoft (R) C/C++ 优化编译器 19.50.35728 版"), undefined)
    assert.deepEqual(parseMsvcBanner("some other tool 1.2"), {})
    assert.deepEqual(parseMsvcBanner(""), {})
    // 版本号在、架构记号不在时只给版本，架构不臆测
    assert.deepEqual(parseMsvcBanner("Compiler 19.50.35728"), { version: "19.50.35728", architecture: undefined })
})

async function toolDirectory(...files: string[]): Promise<{ directory: string, dispose: () => Promise<void> }> {
    const directory = await mkdtemp(join(tmpdir(), "arrange-locator-"))
    await mkdir(directory, { recursive: true })
    for (const file of files) await writeFile(join(directory, file), "")
    return { directory, dispose: () => rm(directory, { recursive: true, force: true }) }
}

test("Windows 定位：无扩展名命令按 PATHEXT 解析，不选同目录下无扩展名的 sh 垫片", async t => {
    const { directory, dispose } = await toolDirectory("pnpm", "pnpm.cmd", "pnpm.ps1")
    t.after(dispose)
    const env = { PATH: directory, PATHEXT: ".COM;.EXE;.BAT;.CMD" }
    assert.equal(await locateTool("pnpm", env, "win32"), join(directory, "pnpm.cmd"))
})

test("Windows 定位：只有无扩展名文件时视为不存在", async t => {
    const { directory, dispose } = await toolDirectory("pnpm")
    t.after(dispose)
    assert.equal(await locateTool("pnpm", { PATH: directory, PATHEXT: ".EXE;.CMD" }, "win32"), undefined)
})

test("Windows 定位：遵循 PATHEXT 顺序，.exe 先于 .cmd，目录顺序先于扩展名顺序", async t => {
    const first = await toolDirectory("tool.cmd")
    const second = await toolDirectory("tool.exe", "tool.cmd")
    t.after(first.dispose)
    t.after(second.dispose)
    assert.equal(await locateTool("tool", { PATH: `${second.directory};${first.directory}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32"), join(second.directory, "tool.exe"))
    assert.equal(await locateTool("tool", { PATH: `${first.directory};${second.directory}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32"), join(first.directory, "tool.cmd"))
})

test("Windows 定位：未设置 PATHEXT 时使用默认值，已带扩展名或完整路径的命令不受影响", async t => {
    const { directory, dispose } = await toolDirectory("npm", "npm.cmd")
    t.after(dispose)
    assert.equal(await locateTool("npm", { PATH: directory }, "win32"), join(directory, "npm.cmd"))
    assert.equal(await locateTool("npm.cmd", { PATH: directory }, "win32"), join(directory, "npm.cmd"))
    assert.equal(await locateTool(join(directory, "npm"), {}, "win32"), join(directory, "npm.cmd"))
})

test("非 Windows 定位仍可使用无扩展名可执行文件", { skip: process.platform === "win32" ? "Windows 上以真实环境验证，见下一项" : false }, async t => {
    const { directory, dispose } = await toolDirectory("pnpm")
    t.after(dispose)
    const path = join(directory, "pnpm")
    await (await import("node:fs/promises")).chmod(path, 0o755)
    assert.equal(await locateTool("pnpm", { PATH: directory }, process.platform), path)
})

test("Windows 真机：Node 自带的 npm 解析为 .cmd，node 解析为 .exe", { skip: process.platform === "win32" ? false : "仅在 Windows 真机运行" }, async () => {
    assert.match((await locateTool("npm"))!, /npm\.cmd$/i)
    assert.match((await locateTool("node"))!, /node\.exe$/i)
})
