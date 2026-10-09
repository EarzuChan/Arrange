import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { CmakeService, type CmakeModel } from "../src/cmake/CmakeService.ts"
import { ArtifactLocator } from "../src/packing/ArtifactLocator.ts"
import { MacBundleSigner } from "../src/packing/MacBundleSigner.ts"
import { Packer } from "../src/packing/Packer.ts"
import { Executor } from "../src/platform/Executor.ts"
import { MacPlatformService } from "../src/platform/MacPlatformService.ts"
import type { ProcessResult, ProcessSpec } from "../src/platform/ProcessSpec.ts"
import { fixture, write } from "./fixture.ts"
import { IconAssetsService } from "../src/asset/IconAssetsService.ts"
import { nativePresentationSignature } from "../src/project/NativePresentation.ts"
import { PNG } from "pngjs"

function result(exitCode = 0, stdout = "", stderr = ""): ProcessResult {
    return { exitCode, stdout, stderr, cancelled: false, timedOut: false }
}

class RecordingExecutor extends Executor {
    readonly calls: ProcessSpec[] = []
    handler: (spec: ProcessSpec) => ProcessResult = () => result()
    override async run(spec: ProcessSpec): Promise<ProcessResult> {
        this.calls.push(spec)
        return this.handler(spec)
    }
}

class ModelCmakeService extends CmakeService {
    ready = true
    constructor(readonly model: CmakeModel) {
        const executor = new RecordingExecutor()
        super(executor, new MacPlatformService(executor), new IconAssetsService())
    }
    override async inspect() { return { ready: this.ready, reason: this.ready ? undefined : "配置已过期", model: this.ready ? this.model : undefined } }
    override async readModel() { return this.model }
}

async function setup(t: TestContext, platform: "darwin" | "win32" = "win32") {
    const state = await fixture(t, false)
    state.local = { native: { generator: "Ninja", architecture: platform === "darwin" ? "arm64" : "x64" } }
    const buildDirectory = resolve(state.rootDir, ".arrange/build/fixture")
    const sourceDirectory = resolve(state.rootDir, state.project.native.directory)
    const standaloneRoot = resolve(buildDirectory, "Standalone", platform === "darwin" ? "A Product.app" : "A Product.exe")
    const standalone = platform === "darwin" ? resolve(standaloneRoot, "Contents/MacOS/A Product") : standaloneRoot
    const vstRoot = resolve(buildDirectory, "VST3/A Product.vst3")
    const vst = resolve(vstRoot, platform === "darwin" ? "Contents/MacOS/A Product" : "Contents/x86_64-win/A Product.vst3")
    await write(standalone, "standalone-binary")
    await write(vst, "vst3-binary")
    await write(resolve(vstRoot, "Contents/Resources/moduleinfo.json"), "{\"Name\":\"A Product\"}")
    if (platform === "darwin") for (const root of [standaloneRoot, vstRoot]) {
        await write(resolve(root, "Contents/Info.plist"), "<plist/>")
        await write(resolve(root, "Contents/Resources/icon.icns"), "icon")
    }
    const ui = resolve(state.rootDir, "ui/dist")
    await write(resolve(ui, "app.js"), "export default {name: 'new-ui'}")
    await write(resolve(ui, "assets/icon.svg"), "<svg/>")
    const target = state.project.native.target
    const model: CmakeModel = {
        sourceDirectory, buildDirectory, configuration: "Release", platform, architecture: state.local.native!.architecture, targets: [
            { name: target, type: "STATIC_LIBRARY", artifacts: [], dependencies: [] },
            { name: `${target}_Standalone`, type: "EXECUTABLE", artifacts: [standalone], dependencies: [target] },
            { name: `${target}_VST3`, type: "MODULE_LIBRARY", artifacts: [vst], dependencies: [target] },
        ]
    }
    const cmake = new ModelCmakeService(model)
    const locator = new ArtifactLocator(cmake)
    const executor = new RecordingExecutor()
    const output = resolve(state.rootDir, "artifacts/release/1.0.0", `${platform === "darwin" ? "macos" : "windows"}-${model.architecture}`)
    return { state, model, cmake, locator, executor, output, ui, standaloneRoot, standalone, vstRoot, vst }
}

async function oldOutput(output: string) {
    await write(resolve(output, "standalone/old.txt"), "old-standalone")
    await write(resolve(output, "vst3/old.txt"), "old-vst3")
    await write(resolve(output, "arrange-package.json"), "old-manifest")
}

test("Windows 真实 File API 形状定位完整 VST3，Standalone 共用定位；不猜 PRODUCT_NAME", async t => {
    const input = await setup(t)
    const artifacts = await input.locator.locate(input.state, { flavor: "release", products: ["standalone", "vst3"] })
    assert.equal(artifacts[0].binaryPath, input.standalone)
    assert.equal(artifacts[1].productPath, input.vstRoot)
    assert.equal(artifacts[1].resourceRoot, resolve(input.vstRoot, "Contents/Resources"))
    assert.equal((await input.locator.locateStandalone(input.state, "release")).productPath, input.standalone)
    assert.equal(artifacts[1].uiRelativePath, "Contents/Resources/ui")
})

test("macOS .app/.vst3 以完整 bundle 交付，并保留 Info.plist、Resources 与 moduleinfo", async t => {
    const input = await setup(t, "darwin")
    const artifacts = await input.locator.locate(input.state, { flavor: "release", products: ["standalone", "vst3"] })
    assert.equal(artifacts[0].productPath, input.standaloneRoot)
    assert.equal(artifacts[0].uiRelativePath, "Contents/Resources/ui")
    input.executor.handler = spec => spec.args.includes("--entitlements") ? result() : spec.args.includes("--display") ? result(0, "", "Signature=adhoc\nIdentifier=A.Product") : result()
    const packed = await new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone", "vst3"], clean: true })
    for (const product of packed.products) {
        assert.equal(await readFile(resolve(product.path, "Contents/Info.plist"), "utf8"), "<plist/>")
        assert.equal(await readFile(resolve(product.uiPath, "assets/icon.svg"), "utf8"), "<svg/>")
    }
    assert.equal(await readFile(resolve(packed.products[1].path, "Contents/Resources/moduleinfo.json"), "utf8"), "{\"Name\":\"A Product\"}")
    assert.ok(input.executor.calls.every(spec => spec.command.endsWith("/codesign")))
})

test("locator 拒绝过期准备、错误 configuration/architecture、缺失二进制及缺失完整 bundle", async t => {
    const input = await setup(t)
    input.cmake.ready = false
    await assert.rejects(input.locator.locateStandalone(input.state, "release"), /配置已过期/)
    input.cmake.ready = true
    await assert.rejects(input.locator.locateStandalone(input.state, "debug"), /配置不符/)
    input.state.local!.native!.architecture = "arm64"
    await assert.rejects(input.locator.locateStandalone(input.state, "release"), /架构不符/)
    input.state.local!.native!.architecture = "x64"
    await rm(input.vst)
    await assert.rejects(input.locator.locate(input.state, { flavor: "release", products: ["vst3"] }), /请先 arrange build/)
    const wrong = resolve(input.model.buildDirectory, "bare.vst3")
    await write(wrong, "binary")
    const targets = input.model.targets.map(target => target.name.endsWith("_VST3") ? { ...target, artifacts: [wrong] } : target)
    await assert.rejects(new ArtifactLocator(new ModelCmakeService({ ...input.model, targets })).locate(input.state, { flavor: "release", products: ["vst3"] }), /完整 .vst3 bundle/)
})

test("package 复制完整 UI，移除旧 assets，--clean 只清所选产品；无任何工具执行", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    await write(resolve(input.output, "standalone/ui/assets/stale.svg"), "stale")
    await write(resolve(input.state.rootDir, "artifacts/debug/windows-x64/keep.txt"), "keep")
    const packed = await new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"], clean: true })
    assert.equal(await readFile(resolve(packed.products[0].uiPath, "assets/icon.svg"), "utf8"), "<svg/>")
    await assert.rejects(lstat(resolve(input.output, "standalone/old.txt")), { code: "ENOENT" })
    await assert.rejects(lstat(resolve(input.output, "standalone/ui/assets/stale.svg")), { code: "ENOENT" })
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
    assert.equal(await readFile(resolve(input.state.rootDir, "artifacts/debug/windows-x64/keep.txt"), "utf8"), "keep")
    assert.equal(input.executor.calls.length, 0)
    assert.equal(JSON.parse(await readFile(packed.manifestPath, "utf8")).products[0].product, "standalone")
})

test("无 --clean 保留所选目录额外文件，但当前 bundle/UI 总是完整替换", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    await write(resolve(input.output, "vst3/A Product.vst3/Contents/Resources/ui/stale.txt"), "stale")
    const packed = await new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["vst3"] })
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
    await assert.rejects(lstat(resolve(packed.products[0].uiPath, "stale.txt")), { code: "ENOENT" })
    assert.equal(await readFile(resolve(packed.products[0].path, "Contents/Resources/moduleinfo.json"), "utf8"), "{\"Name\":\"A Product\"}")
})

test("显示名改变后按清单替换 CLI 旧产物，同时保留用户额外产品", async t => {
    for (const platform of ["win32", "darwin"] as const) {
        const input = await setup(t, platform)
        const options = { flavor: "release", products: ["standalone", "vst3"] } as const
        await new Packer(input.locator, input.executor).pack(input.state, options)
        for (const product of options.products) await write(resolve(input.output, product, "Manual.vst3/notes.txt"), "用户文件")
        for (const root of [input.standaloneRoot, input.vstRoot]) {
            const next = root.replaceAll("A Product", "新 产品")
            await rename(root, next)
            if (!root.endsWith(".exe")) {
                const binary = root === input.standaloneRoot ? input.standalone : input.vst
                await rename(resolve(next, platform === "darwin" ? "Contents/MacOS" : "Contents/x86_64-win", basename(binary)), binary.replaceAll("A Product", "新 产品"))
            }
        }
        input.state.project.project.displayName = "新 产品"
        await write(resolve(input.state.rootDir, ".arrange/built-native-release.json"), JSON.stringify({ status: "completed", projectVersion: input.state.project.project.version, frameworkVersion: input.state.project.framework.version, target: input.state.project.native.target, products: [...options.products], configuration: "Release", platform, architecture: input.model.architecture, presentationSignature: await nativePresentationSignature(input.state, platform) }))
        const model = { ...input.model, targets: input.model.targets.map(target => ({ ...target, artifacts: target.artifacts.map(path => path.replaceAll("A Product", "新 产品")) })) }
        const packed = await new Packer(new ArtifactLocator(new ModelCmakeService(model)), input.executor).pack(input.state, options)
        for (const product of packed.products) {
            assert.match(product.path, /新 产品/)
            assert.equal(await readFile(resolve(input.output, product.product, "Manual.vst3/notes.txt"), "utf8"), "用户文件")
            assert.ok((await readdir(resolve(input.output, product.product))).every(name => !name.startsWith("A Product")))
        }
    }
})

test("不信任越界或其它工程的旧产物清单", async t => {
    const input = await setup(t)
    const directory = resolve(input.output, "standalone")
    await write(resolve(directory, "Keep.exe"), "用户程序")
    const manifest = { format: 1, project: input.state.project.project.name, nativeTarget: input.state.project.native.target, product: "standalone", platform: "win32", architecture: "x64", binary: "Keep.exe" }
    for (const change of [{ project: "Other" }, { binary: "../Keep.exe" }, { binary: "C:\\Keep.exe" }, { binary: "/Keep.exe" }]) {
        await write(resolve(directory, "arrange-package.json"), JSON.stringify({ ...manifest, ...change }))
        await new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"] })
        assert.equal(await readFile(resolve(directory, "Keep.exe"), "utf8"), "用户程序")
    }
})

test("Windows VST3 暂存后恢复图标 shell 属性，失败保留上次交付", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    await write(resolve(input.vstRoot, "Plugin.ico"), "ico")
    await write(resolve(input.vstRoot, ".arrange-icon"), "")
    await write(resolve(input.vstRoot, "desktop.ini"), "[.ShellClassInfo]\nIconResource=Plugin.ico,0\n")
    input.executor.handler = () => result(1, "", "attrib failed")
    await assert.rejects(new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["vst3"] }), /图标属性/)
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
    input.executor.calls.length = 0
    input.executor.handler = () => result()
    const packed = await new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["vst3"] })
    assert.equal(await readFile(resolve(packed.products[0].path, "Plugin.ico"), "utf8"), "ico")
    await assert.rejects(lstat(resolve(packed.products[0].path, ".arrange-icon")), { code: "ENOENT" })
    assert.equal(input.executor.calls.length, 3)
    assert.ok(input.executor.calls.every(call => call.command === "attrib" && call.cwd?.includes(".arrange-package-")))
})

test("configure 后也不能用旧 receipt 打包改名或换图后的二进制；Windows 忽略 bundleId", async t => {
    const input = await setup(t)
    const metadata = input.state.project.project
    metadata.displayName = "A Product"
    metadata.bundleId = "com.example.product"
    const signature = await nativePresentationSignature(input.state, "win32")
    metadata.bundleId = "com.example.changed"
    assert.equal(await nativePresentationSignature(input.state, "win32"), signature)
    const record = { status: "completed", projectVersion: metadata.version, frameworkVersion: input.state.project.framework.version, target: input.state.project.native.target, products: ["standalone"], configuration: "Release", platform: "win32", architecture: "x64", presentationSignature: signature }
    const path = resolve(input.state.rootDir, ".arrange/built-native-release.json")
    await write(path, JSON.stringify(record))
    const packer = new Packer(input.locator, input.executor)
    const options = { flavor: "release", products: ["standalone"] } as const
    await packer.pack(input.state, options)
    metadata.displayName = "Changed"
    await assert.rejects(packer.pack(input.state, options), /显示名、Bundle ID 或图标/)
    metadata.displayName = "A Product"
    metadata.icon = "assets/icon.png"
    const png = new PNG({ width: 256, height: 256 })
    png.data.fill(255)
    const iconPath = resolve(input.state.rootDir, metadata.icon)
    await write(iconPath, "")
    await writeFile(iconPath, PNG.sync.write(png))
    await assert.rejects(packer.pack(input.state, options), /显示名、Bundle ID 或图标/)
    await write(path, JSON.stringify({ ...record, presentationSignature: await nativePresentationSignature(input.state, "win32") }))
    await packer.pack(input.state, options)
    png.data[0] = 0
    await writeFile(iconPath, PNG.sync.write(png))
    await assert.rejects(packer.pack(input.state, options), /显示名、Bundle ID 或图标/)
    delete metadata.icon
    await assert.rejects(packer.pack(input.state, options), /显示名、Bundle ID 或图标/)
    await rm(path)
    await assert.rejects(packer.pack(input.state, options), /需要 CLI 原生构建记录/)
})

test("暂存仅复制额外内容，保留相对链接及未知 bundle，替换当前产品后清单正确", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    const destination = resolve(input.output, "vst3")
    const oldProduct = resolve(destination, "A Product.vst3")
    await write(resolve(oldProduct, "Contents/Resources/moduleinfo.json"), "旧模块信息")
    await write(resolve(oldProduct, "Contents/Resources/ui/stale.txt"), "旧 UI")
    await write(resolve(destination, "notes/custom.txt"), "保留用户内容")
    await write(resolve(destination, "Other.vst3/custom.txt"), "未知旧产品")
    await symlink("../A Product.vst3/Contents/Resources/moduleinfo.json", resolve(destination, "notes/module-link"))
    class CopyRecorder extends Packer {
        readonly sources: string[] = []
        protected override async copy(source: string, target: string): Promise<void> {
            this.sources.push(source)
            await super.copy(source, target)
        }
    }
    const packer = new CopyRecorder(input.locator, input.executor)
    const packed = await packer.pack(input.state, { flavor: "release", products: ["vst3"] })
    assert.ok(!packer.sources.includes(destination))
    assert.ok(!packer.sources.includes(oldProduct))
    assert.equal(await readFile(resolve(destination, "notes/custom.txt"), "utf8"), "保留用户内容")
    assert.equal(await readFile(resolve(destination, "Other.vst3/custom.txt"), "utf8"), "未知旧产品")
    assert.equal(await readFile(resolve(destination, "notes/module-link"), "utf8"), '{"Name":"A Product"}')
    await assert.rejects(readFile(resolve(packed.products[0].uiPath, "stale.txt")), { code: "ENOENT" })
    const manifest = JSON.parse(await readFile(resolve(destination, "arrange-package.json"), "utf8"))
    assert.equal(manifest.uiEntrySha256, createHash("sha256").update(await readFile(resolve(input.ui, "app.js"))).digest("hex"))
})

test("保留额外内容复制失败时不动旧产品与清单", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    const oldFile = resolve(input.output, "standalone/old.txt")
    class FailedExtraCopy extends Packer {
        protected override async copy(source: string, destination: string): Promise<void> {
            if (source === oldFile) throw new Error("模拟额外文件复制失败")
            await super.copy(source, destination)
        }
    }
    await assert.rejects(new FailedExtraCopy(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"] }), /额外文件复制失败/)
    assert.equal(await readFile(oldFile, "utf8"), "old-standalone")
    assert.equal(await readFile(resolve(input.output, "arrange-package.json"), "utf8"), "old-manifest")
    assert.ok((await readdir(input.output)).every(name => !name.startsWith(".arrange-package-")))
})

test("无外部工具的 Windows 打包在复制期间取消，也不能提交新产物", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    const controller = new AbortController()
    class CancelledCopyPacker extends Packer {
        protected override async copy(source: string, destination: string): Promise<void> {
            await super.copy(source, destination)
            if (source === input.ui) controller.abort()
        }
    }
    await assert.rejects(new CancelledCopyPacker(input.locator, input.executor, controller.signal).pack(input.state, { flavor: "release", products: ["standalone"], clean: true }), error => error instanceof Error && error.name === "AbortError")
    assert.equal(await readFile(resolve(input.output, "standalone/old.txt"), "utf8"), "old-standalone")
    assert.equal(await readFile(resolve(input.output, "arrange-package.json"), "utf8"), "old-manifest")
    assert.ok((await readdir(input.output)).every(name => !name.startsWith(".arrange-package-")))
})

test("同轮打包中 UI 入口变化时拒绝混用版本，全部旧交付保持不变", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    class ChangingUiPacker extends Packer {
        changed = false
        protected override async copy(source: string, destination: string): Promise<void> {
            await super.copy(source, destination)
            if (source === input.ui && !this.changed) {
                this.changed = true
                await write(resolve(input.ui, "app.js"), "export default {name: 'changed-mid-package'}")
            }
        }
    }
    await assert.rejects(new ChangingUiPacker(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone", "vst3"], clean: true }), /UI 复制验证失败/)
    assert.equal(await readFile(resolve(input.output, "standalone/old.txt"), "utf8"), "old-standalone")
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
    assert.equal(await readFile(resolve(input.output, "arrange-package.json"), "utf8"), "old-manifest")
    assert.ok((await readdir(input.output)).every(name => !name.startsWith(".arrange-package-")))
})

test("复制第二个产品失败保留全部旧交付物，清除 staging", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    class FailedCopyPacker extends Packer {
        protected override async copy(source: string, destination: string) {
            if (source === input.vstRoot) throw new Error("模拟复制故障")
            return super.copy(source, destination)
        }
    }
    await assert.rejects(new FailedCopyPacker(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone", "vst3"], clean: true }), /模拟复制故障/)
    assert.equal(await readFile(resolve(input.output, "standalone/old.txt"), "utf8"), "old-standalone")
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
    assert.equal(await readFile(resolve(input.output, "arrange-package.json"), "utf8"), "old-manifest")
    assert.ok((await readdir(input.output)).every(name => !name.startsWith(".arrange-package-")))
})

test("提交第二个产品失败回退已经替换的首个产品和第二个备份", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    class FailedCommitPacker extends Packer {
        protected override async move(source: string, destination: string) {
            if (source.includes(".arrange-package-") && basename(source) === "vst3" && destination === resolve(input.output, "vst3")) throw new Error("模拟提交故障")
            return super.move(source, destination)
        }
    }
    await assert.rejects(new FailedCommitPacker(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone", "vst3"], clean: true }), /模拟提交故障/)
    assert.equal(await readFile(resolve(input.output, "standalone/old.txt"), "utf8"), "old-standalone")
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
    assert.equal(await readFile(resolve(input.output, "arrange-package.json"), "utf8"), "old-manifest")
    assert.ok((await readdir(input.output)).every(name => !name.startsWith(".arrange-package-")))
})

test("拒绝工程根、UI、native、.arrange 重叠输出与符号链接绕过", async t => {
    const input = await setup(t)
    const packer = new Packer(input.locator, input.executor)
    for (const directory of [".", "ui/output", "native/output", ".arrange/output"]) {
        input.state.project.artifacts.directory = directory
        await assert.rejects(packer.pack(input.state, { flavor: "release", products: ["standalone"], clean: true }), /覆盖工程根|重叠/)
    }
    const redirect = resolve(input.state.rootDir, "redirect")
    await symlink(resolve(input.state.rootDir, "ui"), redirect, "dir")
    input.state.project.artifacts.directory = "redirect/output"
    await assert.rejects(packer.pack(input.state, { flavor: "release", products: ["standalone"], clean: true }), /重叠/)
    assert.equal(await readFile(resolve(input.ui, "app.js"), "utf8"), "export default {name: 'new-ui'}")
})

test("拒绝 UI 包外符号链接、产物目录链接以及缺失 UI 入口，旧交付不变", async t => {
    const input = await setup(t)
    await oldOutput(input.output)
    const external = resolve(input.state.rootDir, "outside.txt")
    await write(external, "outside")
    await symlink(external, resolve(input.ui, "outside-link"))
    await assert.rejects(new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"], clean: true }), /符号链接/)
    await rm(resolve(input.ui, "outside-link"))
    await rm(resolve(input.output, "standalone"), { recursive: true })
    await symlink(dirname(external), resolve(input.output, "standalone"), "dir")
    await assert.rejects(new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"], clean: true }), /不是普通目录/)
    await rm(resolve(input.ui, "app.js"))
    await assert.rejects(new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["vst3"], clean: true }), /缺少普通文件 app.js/)
    assert.equal(await readFile(external, "utf8"), "outside")
    assert.equal(await readFile(resolve(input.output, "vst3/old.txt"), "utf8"), "old-vst3")
})

test("交付平台目录不能经链接清理另一 flavor 或 platform", async t => {
    const input = await setup(t)
    const otherPlatform = resolve(input.state.rootDir, "artifacts/release/1.0.0/windows-arm64")
    await write(resolve(otherPlatform, "standalone/keep.txt"), "keep")
    await symlink(otherPlatform, input.output, "dir")
    await assert.rejects(new Packer(input.locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"], clean: true }), /交付路径含有符号链接/)
    assert.equal(await readFile(resolve(otherPlatform, "standalone/keep.txt"), "utf8"), "keep")
})

test("Windows 只复制目标图中明确的 DLL，文件名冲突拒绝", async t => {
    const input = await setup(t)
    const library = resolve(input.model.buildDirectory, "library/Effect.dll")
    await write(library, "runtime-dll")
    const targets = input.model.targets.map(target => target.name.endsWith("_Standalone") ? { ...target, dependencies: [...target.dependencies, "library"] } : target)
    targets.push({ name: "library", type: "SHARED_LIBRARY", artifacts: [library], dependencies: [] })
    const locator = new ArtifactLocator(new ModelCmakeService({ ...input.model, targets }))
    const packed = await new Packer(locator, input.executor).pack(input.state, { flavor: "release", products: ["standalone"] })
    assert.equal(await readFile(resolve(dirname(packed.products[0].binaryPath), "Effect.dll"), "utf8"), "runtime-dll")
    const conflict = resolve(input.model.buildDirectory, "another/Effect.dll")
    await write(conflict, "conflict")
    targets.push({ name: "another", type: "SHARED_LIBRARY", artifacts: [conflict], dependencies: [] })
    targets[1] = { ...targets[1], dependencies: [...targets[1].dependencies, "another"] }
    await assert.rejects(new ArtifactLocator(new ModelCmakeService({ ...input.model, targets })).locateStandalone(input.state, "release"), /文件名冲突/)
})

test("手动既有产物可无 CLI receipt；已有 receipt 的版本/目标/失败状态必须阻断", async t => {
    const input = await setup(t)
    const packer = new Packer(input.locator, input.executor)
    const options = { flavor: "release", products: ["standalone"] } as const
    const initial = await packer.pack(input.state, options)
    assert.deepEqual(JSON.parse(await readFile(initial.manifestPath, "utf8")).buildRecords, { ui: null, native: null })
    const uiRecord = resolve(input.state.rootDir, ".arrange/built-ui.json")
    const nativeRecord = resolve(input.state.rootDir, ".arrange/built-native-release.json")
    const goodUi = { status: "completed", projectVersion: "1.0.0", frameworkVersion: input.state.project.framework.version, path: input.ui }
    const goodNative = { status: "completed", projectVersion: "1.0.0", frameworkVersion: input.state.project.framework.version, target: input.state.project.native.target, products: ["standalone", "vst3"], configuration: "Release", platform: "win32", architecture: "x64" }
    for (const change of [{ projectVersion: "2.0.0" }, { frameworkVersion: "0.0.0-m.9.0" }, { status: "failed" }, { status: undefined }, { path: resolve(input.ui, "wrong") }]) {
        await write(uiRecord, JSON.stringify({ ...goodUi, ...change }))
        await assert.rejects(packer.pack(input.state, options), /构建记录/)
    }
    await write(uiRecord, JSON.stringify(goodUi))
    for (const change of [{ target: "Other" }, { architecture: "arm64" }, { configuration: "Debug" }, { products: ["vst3"] }, { status: "building" }, { status: undefined }]) {
        await write(nativeRecord, JSON.stringify({ ...goodNative, ...change }))
        await assert.rejects(packer.pack(input.state, options), /构建记录/)
    }
    await write(nativeRecord, JSON.stringify({ ...goodNative, status: "completed" }))
    const packed = await packer.pack(input.state, options)
    const manifest = JSON.parse(await readFile(packed.manifestPath, "utf8"))
    assert.equal(manifest.buildRecords.ui.frameworkVersion, input.state.project.framework.version)
    assert.equal(manifest.buildRecords.native.target, input.state.project.native.target)
    await write(uiRecord, "[")
    await assert.rejects(packer.pack(input.state, options), /构建记录损坏/)
})

test("Mac 本地 ad-hoc 修复保留 metadata，身份签名失效拒绝降级", async () => {
    const executor = new RecordingExecutor()
    let verified = false
    executor.handler = spec => {
        if (spec.args.includes("--entitlements")) return result(0, "<plist><dict/></plist>")
        if (spec.args.includes("--display")) return result(0, "", "Signature=adhoc\nIdentifier=A.Product")
        if (spec.args.includes("--sign")) {
            verified = true
            return result()
        }
        return verified ? result() : result(1, "", "resource envelope is obsolete")
    }
    await new MacBundleSigner(executor).ensureRunnable("original.app", "staged.app")
    const signing = executor.calls.find(spec => spec.args.includes("--sign"))!
    assert.ok(signing.args.includes("--preserve-metadata=identifier,entitlements,flags,runtime"))
    assert.ok(!signing.args.includes("--deep"))
    const identity = new RecordingExecutor()
    identity.handler = spec => spec.args.includes("--entitlements") ? result() : spec.args.includes("--display") ? result(0, "", "Authority=Developer ID Application: Example\nTeamIdentifier=EXAMPLE") : result(1, "", "resource changed")
    await assert.rejects(new MacBundleSigner(identity).ensureRunnable("original.app", "staged.app"), /身份签名失效/)
    assert.ok(identity.calls.every(spec => !spec.args.includes("--sign")))
})

test("Mac 签名各阶段取消时立即中止，不能继续重签或误报签名损坏", async () => {
    for (let cancelledAt = 1; cancelledAt <= 7; cancelledAt++) {
        const executor = new RecordingExecutor()
        executor.handler = spec => {
            if (executor.calls.length === cancelledAt) return { ...result(130), cancelled: true }
            if (spec.args.includes("--entitlements")) return result()
            if (spec.args.includes("--display")) return result(0, "", "Signature=adhoc\nIdentifier=Test.Product")
            if (spec.args.includes("--verify")) return result(executor.calls.length === 3 ? 1 : 0)
            return result()
        }
        await assert.rejects(new MacBundleSigner(executor).ensureRunnable("original.app", "staged.app"), error => error instanceof Error && error.name === "AbortError")
        assert.equal(executor.calls.length, cancelledAt)
    }
})

test("Mac 已有效签名不重签；unsigned 修复后必须验证；entitlements 丢失拒绝", async () => {
    const valid = new RecordingExecutor()
    valid.handler = spec => spec.args.includes("--entitlements") ? result() : spec.args.includes("--display") ? result(0, "", "Authority=Developer ID Application") : result()
    await new MacBundleSigner(valid).ensureRunnable("original.app", "staged.app")
    assert.ok(valid.calls.every(spec => !spec.args.includes("--sign")))
    const unsigned = new RecordingExecutor()
    unsigned.handler = spec => spec.args.includes("--display") ? (spec.args.at(-1) === "original.app" ? result(1, "", "code object is not signed at all") : result(0, "", "Signature=adhoc")) : spec.args.includes("--verify") ? result(1, "", "still invalid") : result()
    await assert.rejects(new MacBundleSigner(unsigned).ensureRunnable("original.app", "staged.app"), /签名验证失败/)
    assert.ok(unsigned.calls.some(spec => spec.args.includes("--sign")))
    const lost = new RecordingExecutor()
    lost.handler = spec => spec.args.includes("--display") ? (spec.args.includes("--entitlements") ? result(0, spec.args.at(-1) === "original.app" ? "<plist><dict/></plist>" : "") : result(0, "", "Signature=adhoc")) : spec.args.includes("--verify") ? result(1) : result()
    await assert.rejects(new MacBundleSigner(lost).ensureRunnable("original.app", "staged.app"), /改变了 entitlements/)
})
