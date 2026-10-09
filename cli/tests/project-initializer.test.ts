import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test, type TestContext } from "node:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defaultProjectDirectories, defaultProjectIconPath, uiToolchainVersions } from "../src/CliMetadata.ts"
import { createInitialProjectState, type CreateProjectRequest } from "../src/project/CreateProject.ts"
import { ProjectInitializer, type CopyPlan } from "../src/project/ProjectInitializer.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { ConfigScanner } from "../src/sync/ConfigScanner.ts"
import { configRegistry } from "../src/config/ConfigRegistry.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import type { FileSnapshot } from "../src/util/FileUtils.ts"
import { readUiSuggestions } from "../src/wizard/Adopt.ts"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

async function temporaryRoot(t: TestContext): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "arrange-initializer-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    return root
}

function request(rootDir: string): CreateProjectRequest {
    return { rootDir, projectName: "StarterPlugin", projectVersion: "1.2.3", frameworkVersion: "0.0.0-m.2.2", vendorName: "Test Company", vendorCode: "Test", pluginCode: "StrP", pluginType: "effect", packageManager: "npm", products: ["standalone", "vst3"], uiDirectory: defaultProjectDirectories.ui, nativeDirectory: defaultProjectDirectories.native, artifactsDirectory: defaultProjectDirectories.artifacts, managedItems: Object.fromEntries(configRegistry.items.map(item => [item.id, true])) }
}

async function write(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, "utf8")
}

test("create 生成统一托管文件、SFA 工程与完整 effect/instrument Processor", async t => {
    const root = await temporaryRoot(t)
    for (const pluginType of ["effect", "instrument"] as const) {
        const state = await new ProjectInitializer(new FileTransaction()).create({ ...request(resolve(root, pluginType)), pluginType })
        const loaded = await new ProjectStateStore(new FileTransaction()).load(state.rootDir)
        assert.equal(loaded.project.native.target, "StarterPlugin")
        assert.equal(loaded.local, null)
        for (const file of configRegistry.files) assert.equal(await readFile(file.path(state), "utf8"), file.make(state))
        const report = await new ConfigScanner(configRegistry).scan(state, "Global")
        assert.equal(report.fatal.length + report.resolvable.length + report.applicable.length, 0)
        const manifest = JSON.parse(await readFile(resolve(state.rootDir, "ui/package.json"), "utf8"))
        assert.equal(manifest.devDependencies.vite, uiToolchainVersions.vite)
        assert.equal(manifest.devDependencies.tsx, uiToolchainVersions.tsx)
        assert.equal(manifest.devDependencies["@types/node"], uiToolchainVersions.nodeTypes)
        assert.match(manifest.scripts.build, /check-types\.ts.*vite build.*runner/)
        assert.match(await readFile(resolve(state.rootDir, "ui/src/main.ts"), "utf8"), /createApp\(App\)\.mount/)
        const cpp = await readFile(resolve(state.rootDir, "native/Source/StarterPluginProcessor.cpp"), "utf8")
        assert.match(cpp, /createPluginFilter/)
        assert.match(cpp, /config\.app\.useDist\(\)/)
        assert.match(cpp, /config\.app\.useLive\(\)/)
        assert.equal(cpp.includes('.withInput("Input"'), pluginType === "effect")
        assert.equal(cpp.includes("buffer.clear();"), pluginType === "instrument")
        assert.deepEqual(await readdir(resolve(state.rootDir, ".arrange/initializations")), [])
        assert.deepEqual(await readdir(resolve(state.rootDir, ".arrange/transactions")), [])
    }
})

test("生成的现代 SFA 使用真实公开 API 和 PNG/SVG ESM 资源，并通过隔离类型检查", async t => {
    const state = await new ProjectInitializer(new FileTransaction()).create({ ...request(await temporaryRoot(t)), displayName: "中文 显示 & 名称" })
    const uiRoot = resolve(state.rootDir, "ui")
    const modules = resolve(uiRoot, "node_modules")
    for (const name of ["framework", "reactivity", "shared", "compiler", "vite-plugin"]) {
        const packageRoot = resolve(modules, "@arrange", name)
        await mkdir(packageRoot, { recursive: true })
        await cp(resolve(repoRoot, "packages", name, "src"), resolve(packageRoot, "src"), { recursive: true })
        await cp(resolve(repoRoot, "packages", name, "package.json"), resolve(packageRoot, "package.json"))
    }
    const framework = JSON.parse(await readFile(resolve(repoRoot, "packages/framework/package.json"), "utf8"))
    for (const name of Object.keys(framework.dependencies).filter(name => !name.startsWith("@arrange/"))) {
        await mkdir(dirname(resolve(modules, name)), { recursive: true })
        await symlink(resolve(repoRoot, "packages/framework/node_modules", name), resolve(modules, name), "junction")
    }
    const assets = resolve(uiRoot, "src/assets")
    await mkdir(assets, { recursive: true })
    await cp(resolve(repoRoot, "demo/ui-src/public/logo.png"), resolve(assets, "logo.png"))
    await cp(resolve(repoRoot, "demo/ui-src/public/icons/play.svg"), resolve(assets, "play.svg"))
    const appPath = resolve(uiRoot, "src/App.sfa")
    const app = await readFile(appPath, "utf8")
    assert.match(app, /const projectTitle = "中文 显示 & 名称"/)
    await write(appPath, app.replace("<script>", `<script>
import logo from './assets/logo.png'
import play from './assets/play.svg'
import { painter } from '@arrange/framework/ui'

const logoPainter = painter(logo)
const playPainter = painter(play)
`))
    const runTypecheck = () => promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), "scripts/check-types.ts"], { cwd: uiRoot, timeout: 30000 })
    await assert.rejects(runTypecheck(), error => {
        assert.match((error as Error & { stderr: string }).stderr, /Cannot find type definition file for 'node'/)
        return true
    })
    await cp(resolve(repoRoot, "node_modules/@types/node"), resolve(modules, "@types/node"), { recursive: true, dereference: true })
    const checked = await runTypecheck()
    assert.match(checked.stdout, /SFA 脚本与模板类型检查通过/)
})

test("create 的只读计划与冲突保护不覆盖源码、不留下工程或事务", async t => {
    const root = await temporaryRoot(t)
    const initializer = new ProjectInitializer(new FileTransaction())
    const plan = await initializer.planCreate(request(root))
    assert.deepEqual(await readdir(root), [])
    const source = resolve(root, "native/Source/StarterPluginProcessor.cpp")
    await write(source, "用户源码\n")
    await assert.rejects(initializer.apply(plan), /扫描后发生变化/)
    await assert.rejects(initializer.create(request(root)), /目标已经存在/)
    assert.equal(await readFile(source, "utf8"), "用户源码\n")
    await assert.rejects(readFile(resolve(root, "arrange.project.yaml")), { code: "ENOENT" })
    await assert.rejects(readdir(resolve(root, ".arrange")), { code: "ENOENT" })
})

test("外部 PNG 只读验证后原样复制到独立 assets；缺省不创建品牌图标", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "外部 图标.png")
    await cp(resolve(repoRoot, "artworks/logo.png"), source)
    const initializer = new ProjectInitializer(new FileTransaction())
    const plan = await initializer.planCreate({ ...request(resolve(parent, "with-icon")), iconSource: source, displayName: "中文 产品" })
    assert.equal(plan.state.project.project.icon, defaultProjectIconPath)
    assert.deepEqual(await readdir(parent), ["外部 图标.png"])
    const state = await initializer.apply(plan)
    assert.deepEqual(await readFile(resolve(state.rootDir, defaultProjectIconPath)), await readFile(source))
    const loaded = await new ProjectStateStore(new FileTransaction()).load(state.rootDir)
    assert.equal(loaded.project.project.displayName, "中文 产品")
    assert.equal(loaded.project.project.bundleId, "com.testcompany.starterplugin")
    const manifest = JSON.parse(await readFile(resolve(state.rootDir, "ui/package.json"), "utf8"))
    assert.equal(manifest.name, "starterplugin")
    assert.equal(loaded.project.native.target, "StarterPlugin")
    const plain = await initializer.create(request(resolve(parent, "without-icon")))
    assert.equal(plain.project.project.icon, undefined)
    await assert.rejects(readdir(resolve(plain.rootDir, "assets")), { code: "ENOENT" })
})

test("adopt 直接引用同路径 PNG；不重复写入，确认后变更或链接替换仍拒绝", async t => {
    const initializer = new ProjectInitializer(new FileTransaction())
    const root = await temporaryRoot(t)
    const icon = resolve(root, defaultProjectIconPath)
    await mkdir(dirname(icon), { recursive: true })
    await cp(resolve(repoRoot, "artworks/logo.png"), icon)
    await write(resolve(root, "ui/package.json"), "{}\n")
    await write(resolve(root, "native/CMakeLists.txt"), "project(ExistingTarget)\n")
    const input = { state: createInitialProjectState(request(root)), ui: { kind: "existing" }, native: { kind: "existing" }, iconSource: icon } as const
    const plan = await initializer.planAdopt(input)
    assert.equal(plan.icons[0].kind, "existing")
    const before = await readFile(icon)
    await writeFile(icon, "确认后修改")
    await assert.rejects(initializer.apply(plan), /图标源文件在确认后发生变化/)
    await assert.rejects(readdir(resolve(root, ".arrange")), { code: "ENOENT" })
    await writeFile(icon, before)
    const external = await temporaryRoot(t)
    const externalIcon = resolve(external, "icon.png")
    await writeFile(externalIcon, before)
    await rm(icon)
    await symlink(externalIcon, icon, "file")
    await assert.rejects(initializer.apply(plan), /符号链接/)
    await assert.rejects(initializer.planAdopt(input), /符号链接/)
    await rm(icon)
    await writeFile(icon, before)
    const original = await lstat(icon)
    const state = await initializer.apply(plan)
    const after = await lstat(icon)
    assert.equal(after.ino, original.ino)
    assert.equal(after.mtimeMs, original.mtimeMs)
    assert.deepEqual(await readFile(icon), before)
    assert.equal(state.project.project.icon, defaultProjectIconPath)
    assert.equal(state.project["managed-items"].includes("cmake.product-icon"), true)
})

test("图标冲突、无效 PNG、确认后源变动及 assets 与子项目重叠均不写工程", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "icon.png")
    await cp(resolve(repoRoot, "artworks/logo.png"), source)
    const initializer = new ProjectInitializer(new FileTransaction())
    const occupied = resolve(parent, "occupied")
    await write(resolve(occupied, defaultProjectIconPath), "用户图标")
    await assert.rejects(initializer.planCreate({ ...request(occupied), iconSource: source }), /目标已经存在/)
    assert.equal(await readFile(resolve(occupied, defaultProjectIconPath), "utf8"), "用户图标")
    await assert.rejects(readdir(resolve(occupied, ".arrange")), { code: "ENOENT" })
    const invalid = resolve(parent, "invalid")
    await assert.rejects(initializer.planCreate({ ...request(invalid), iconSource: resolve(repoRoot, "demo/ui-src/public/logo.png") }), /正方形 PNG/)
    assert.equal(existsSync(invalid), false)
    const overlap = resolve(parent, "overlap")
    await assert.rejects(initializer.planCreate({ ...request(overlap), iconSource: source, uiDirectory: "assets" }), /assets 目录必须/)
    assert.equal(existsSync(overlap), false)
    const changed = resolve(parent, "changed")
    const plan = await initializer.planCreate({ ...request(changed), iconSource: source })
    await writeFile(source, "确认后改动")
    await assert.rejects(initializer.apply(plan), /图标源文件在确认后发生变化/)
    assert.equal(existsSync(changed), false)
})

test("图标发布后配置中途取消保留原 PNG 与准确失败记录，不继续提交 YAML", async t => {
    const root = await temporaryRoot(t)
    const source = resolve(repoRoot, "artworks/logo.png")
    const controller = new AbortController()
    class CancelledWriter extends FileTransaction {
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            await super.replaceFile(before, after, id)
            controller.abort()
        }
    }
    await assert.rejects(new ProjectInitializer(new CancelledWriter(controller.signal), controller.signal).create({ ...request(root), iconSource: source }), error => error instanceof Error && error.name === "AbortError")
    assert.deepEqual(await readFile(resolve(root, defaultProjectIconPath)), await readFile(source))
    await assert.rejects(readFile(resolve(root, "arrange.project.yaml")), { code: "ENOENT" })
    const paths = await readdir(resolve(root, ".arrange/initializations"))
    const journal = JSON.parse(await readFile(resolve(root, ".arrange/initializations", paths[0]), "utf8"))
    assert.equal(journal.status, "failed")
    assert.equal(journal.icons[0].copied, true)
    assert.equal(journal.icons[0].destination, resolve(root, defaultProjectIconPath))
    assert.deepEqual(await readdir(resolve(root, "assets")), ["icon.png"])
})

test("确认后的目标冲突和 assets 目录链接不会覆盖用户图标或写入外部目录", async t => {
    const source = resolve(repoRoot, "artworks/logo.png")
    const initializer = new ProjectInitializer(new FileTransaction())
    const occupied = await temporaryRoot(t)
    const plan = await initializer.planCreate({ ...request(occupied), iconSource: source })
    await write(resolve(occupied, defaultProjectIconPath), "用户后来放入的图标")
    await assert.rejects(initializer.apply(plan), /目标已经存在/)
    assert.equal(await readFile(resolve(occupied, defaultProjectIconPath), "utf8"), "用户后来放入的图标")
    await assert.rejects(readdir(resolve(occupied, ".arrange")), { code: "ENOENT" })
    const aliased = await temporaryRoot(t)
    const external = await temporaryRoot(t)
    await write(resolve(external, "keep.txt"), "外部内容")
    await symlink(external, resolve(aliased, "assets"), "dir")
    await assert.rejects(initializer.create({ ...request(aliased), iconSource: source }), /符号链接/)
    assert.deepEqual(await readdir(external), ["keep.txt"])
    await assert.rejects(readFile(resolve(aliased, "arrange.project.yaml")), { code: "ENOENT" })
})

test("确认后才建立不存在的工程根，初始化日志仍拒绝根以下工作目录链接", async t => {
    await t.test("尚不存在的多层工程根", async t => {
        const parent = await temporaryRoot(t)
        const root = resolve(parent, "new-parent/new-project")
        const initializer = new ProjectInitializer(new FileTransaction())
        const plan = await initializer.planCreate(request(root))
        assert.deepEqual(await readdir(parent), [])
        await initializer.apply(plan)
        assert.equal((await new ProjectStateStore(new FileTransaction()).load(root)).project.project.name, "StarterPlugin")
        assert.deepEqual(await readdir(resolve(root, ".arrange/initializations")), [])
    })
    for (const aliased of [".arrange", ".arrange/initializations"]) await t.test(aliased, async t => {
        const root = await temporaryRoot(t)
        const external = await temporaryRoot(t)
        await write(resolve(external, "keep.txt"), "外部内容")
        await mkdir(dirname(resolve(root, aliased)), { recursive: true })
        await symlink(external, resolve(root, aliased), "dir")
        const initializer = new ProjectInitializer(new FileTransaction())
        const plan = await initializer.planCreate(request(root))
        await assert.rejects(initializer.apply(plan), /符号链接|非目录/)
        assert.deepEqual(await readdir(external), ["keep.txt"])
        assert.equal(await readFile(resolve(external, "keep.txt"), "utf8"), "外部内容")
        await assert.rejects(readFile(resolve(root, "arrange.project.yaml")), { code: "ENOENT" })
        await assert.rejects(readFile(resolve(root, "native/Source/StarterPluginProcessor.cpp")), { code: "ENOENT" })
        await assert.rejects(readFile(resolve(root, ".arrange/.gitignore")), { code: "ENOENT" })
    })
})

test("已有 .gitignore 原文保留；工程根与各输出目录独立且不可复用已有配置", async t => {
    const root = await temporaryRoot(t)
    await write(resolve(root, ".gitignore"), "# 用户规则\r\nsecret/\r\n")
    await new ProjectInitializer(new FileTransaction()).create(request(root))
    const ignore = await readFile(resolve(root, ".gitignore"), "utf8")
    assert.ok(ignore.startsWith("# 用户规则\r\nsecret/\r\n"))
    assert.match(ignore, /\/arrange\.local\.yaml/)
    assert.match(ignore, /\/ui\/dist\//)
    await assert.rejects(new ProjectInitializer(new FileTransaction()).create(request(root)), /目标已经存在/)
    const other = await temporaryRoot(t)
    await assert.rejects(new ProjectInitializer(new FileTransaction()).create({ ...request(other), nativeDirectory: "ui/native" }), /相互独立/)
    assert.deepEqual(await readdir(other), [])
})

test("初始化计划拒绝所有接入方式占用保留路径，且合法离体工程可原位接入", async t => {
    const root = await temporaryRoot(t)
    const external = await temporaryRoot(t)
    await write(resolve(external, "ui/package.json"), "{}\n")
    await write(resolve(external, "native/CMakeLists.txt"), "project(ExistingTarget)\n")
    const initializer = new ProjectInitializer(new FileTransaction())
    const paths = [".arrange", ".arrange/owned", ".git", ".git/objects", "node_modules", "node_modules/cache", "arrange.project.yaml", "arrange.project.yaml/directory", "arrange.local.yaml"]
    for (const kind of ["new", "existing", "copy"] as const) for (const scope of ["ui", "native", "artifacts"] as const) for (const directory of paths) {
        const state = createInitialProjectState(request(root))
        state.project[scope].directory = directory
        const ui = kind === "copy" ? { kind, sourceDir: resolve(external, "ui") } : { kind }
        const native = kind === "copy" ? { kind, sourceDir: resolve(external, "native") } : { kind }
        await assert.rejects(initializer.planAdopt({ state, ui, native }), /CLI 保留路径重叠/)
    }
    assert.deepEqual(await readdir(root), [])
    const state = createInitialProjectState(request(root))
    state.project.ui.directory = resolve(external, "ui")
    state.project.native.directory = resolve(external, "native")
    const plan = await initializer.planAdopt({ state, ui: { kind: "existing" }, native: { kind: "existing" } })
    assert.deepEqual(plan.copies, [])
    assert.deepEqual(await readdir(root), [])
    assert.equal(await readFile(resolve(external, "ui/package.json"), "utf8"), "{}\n")
    assert.equal(await readFile(resolve(external, "native/CMakeLists.txt"), "utf8"), "project(ExistingTarget)\n")
})

test("adopt 原位保留现有文件和 target；JSON 候选只作为显式确认的输入", async t => {
    const root = await temporaryRoot(t)
    const state = createInitialProjectState(request(root))
    state.project.native.target = "ActualJuceTarget"
    state.project["managed-items"] = ["cmake.product-icon"]
    const cmake = "# 自定义 CMake\nadd_subdirectory(custom)\nset(MY_ICON custom.icns)\n"
    const packageJson = '{"name":"existing-ui","version":"2.3.4","packageManager":"npm@11.0.0","dependencies":{"@arrange/framework":"0.0.0-m.2.2"},"custom":true}\n'
    await write(resolve(root, "native/CMakeLists.txt"), cmake)
    await write(resolve(root, "ui/package.json"), packageJson)
    await write(resolve(root, "ui/src/custom.ts"), "export const custom = true\n")
    assert.deepEqual(await readUiSuggestions(resolve(root, "ui")), { name: "existing-ui", version: "2.3.4", frameworkVersion: "0.0.0-m.2.2", packageManager: "npm" })
    const adopted = await new ProjectInitializer(new FileTransaction()).adopt({ state, ui: { kind: "existing" }, native: { kind: "existing" } })
    assert.equal(adopted.project.project.icon, undefined)
    assert.equal(adopted.project["managed-items"].includes("cmake.product-icon"), false)
    assert.equal(await readFile(resolve(root, "native/CMakeLists.txt"), "utf8"), cmake)
    assert.equal(await readFile(resolve(root, "ui/package.json"), "utf8"), packageJson)
    assert.equal((await new ProjectStateStore(new FileTransaction()).load(root)).project.native.target, "ActualJuceTarget")
    await assert.rejects(readFile(resolve(root, "ui/src/App.sfa")), { code: "ENOENT" })
    assert.equal((await new ConfigScanner(configRegistry).scan(adopted, "Global")).fatal.length, 0)
})

test("adopt 复制一侧、新建另一侧；源目录不改、缓存不复制、独立 target 不取产品名", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "source")
    await write(resolve(source, "package.json"), '{"name":"copied-ui"}\n')
    await write(resolve(source, "src/keep.ts"), "export const keep = 1\n")
    await write(resolve(source, "node_modules/cache.txt"), "cache")
    await write(resolve(source, ".git/config"), "git")
    const state = createInitialProjectState(request(resolve(parent, "project")))
    state.project.native.target = "IndependentTarget"
    await new ProjectInitializer(new FileTransaction()).adopt({ state, ui: { kind: "copy", sourceDir: source }, native: { kind: "new" } })
    assert.equal(await readFile(resolve(state.rootDir, "ui/src/keep.ts"), "utf8"), "export const keep = 1\n")
    assert.equal(await readFile(resolve(source, "node_modules/cache.txt"), "utf8"), "cache")
    await assert.rejects(readdir(resolve(state.rootDir, "ui/node_modules")), { code: "ENOENT" })
    await assert.rejects(readdir(resolve(state.rootDir, "ui/.git")), { code: "ENOENT" })
    const cmake = await readFile(resolve(state.rootDir, "native/CMakeLists.txt"), "utf8")
    assert.match(cmake, /juce_add_plugin\(IndependentTarget/)
    assert.match(cmake, /PRODUCT_NAME "StarterPlugin"/)
    assert.match(cmake, /Source\/IndependentTargetProcessor\.cpp/)
    await assert.rejects(readFile(resolve(state.rootDir, "ui/vite.config.ts")), { code: "ENOENT" })
})

test("复制目的目录在确认后出现时停止；不写配置或动已有目标", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "source")
    await write(resolve(source, "package.json"), "{}\n")
    const state = createInitialProjectState(request(resolve(parent, "project")))
    const initializer = new ProjectInitializer(new FileTransaction())
    const plan = await initializer.planAdopt({ state, ui: { kind: "copy", sourceDir: source }, native: { kind: "new" } })
    await write(resolve(state.rootDir, "ui/user.txt"), "user")
    await assert.rejects(initializer.apply(plan), /目标已经存在/)
    assert.equal(await readFile(resolve(state.rootDir, "ui/user.txt"), "utf8"), "user")
    await assert.rejects(readFile(resolve(state.rootDir, "arrange.project.yaml")), { code: "ENOENT" })
})

test("排他创建复制目标拒绝执行中出现的目录，不覆盖用户文件", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "source")
    await write(resolve(source, "package.json"), "{}\n")
    const state = createInitialProjectState(request(resolve(parent, "project")))
    class ConcurrentInitializer extends ProjectInitializer {
        protected override async copyDirectory(copy: CopyPlan): Promise<void> {
            await write(resolve(copy.destination, "user.txt"), "保留用户内容")
            await super.copyDirectory(copy)
        }
    }
    await assert.rejects(new ConcurrentInitializer(new FileTransaction()).adopt({ state, ui: { kind: "copy", sourceDir: source }, native: { kind: "new" } }), /EEXIST/)
    assert.equal(await readFile(resolve(state.rootDir, "ui/user.txt"), "utf8"), "保留用户内容")
    await assert.rejects(readFile(resolve(state.rootDir, "ui/package.json")), { code: "ENOENT" })
    await assert.rejects(readFile(resolve(state.rootDir, "arrange.project.yaml")), { code: "ENOENT" })
    const paths = await readdir(resolve(state.rootDir, ".arrange/initializations"))
    assert.equal(JSON.parse(await readFile(resolve(state.rootDir, ".arrange/initializations", paths[0]), "utf8")).status, "failed")
})

test("复制过滤保留恰名为 node_modules 的源根，仍排除其缓存及本机配置", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "node_modules")
    await write(resolve(source, "package.json"), '{"name":"root-is-project"}\n')
    await write(resolve(source, "src/keep.ts"), "export const keep = true\n")
    await write(resolve(source, "node_modules/cache.txt"), "缓存")
    await write(resolve(source, ".arrange/cache.txt"), "缓存")
    await write(resolve(source, "arrange.local.yaml"), "本机配置")
    const state = createInitialProjectState(request(resolve(parent, "new-parent/project")))
    await new ProjectInitializer(new FileTransaction()).adopt({ state, ui: { kind: "copy", sourceDir: source }, native: { kind: "new" } })
    assert.equal(await readFile(resolve(state.rootDir, "ui/src/keep.ts"), "utf8"), "export const keep = true\n")
    for (const name of ["node_modules", ".arrange", "arrange.local.yaml"]) await assert.rejects(readFile(resolve(state.rootDir, "ui", name)), { code: "ENOENT" })
    assert.equal(await readFile(resolve(source, "arrange.local.yaml"), "utf8"), "本机配置")
    assert.deepEqual(await readdir(resolve(state.rootDir, ".arrange/initializations")), [])
})

test("成功初始化日志清理失败不把已完成工程报成失败", async t => {
    const root = await temporaryRoot(t)
    class RetainedJournalInitializer extends ProjectInitializer {
        protected override async removeJournal(): Promise<void> { throw new Error("模拟日志清理失败") }
    }
    const state = await new RetainedJournalInitializer(new FileTransaction()).create(request(root))
    assert.equal((await new ProjectStateStore(new FileTransaction()).load(root)).project.project.name, state.project.project.name)
    const paths = await readdir(resolve(root, ".arrange/initializations"))
    assert.equal(paths.length, 1)
    assert.equal(JSON.parse(await readFile(resolve(root, ".arrange/initializations", paths[0]), "utf8")).status, "complete")
    assert.deepEqual(await readdir(resolve(root, ".arrange/transactions")), [])
})

test("初始化配置写入中途取消停止后续文件，两类失败记录保留且 AbortError 穿透", async t => {
    const root = await temporaryRoot(t)
    const controller = new AbortController()
    class CancelledWriter extends FileTransaction {
        protected override async replaceFile(before: FileSnapshot, after: string, id: string): Promise<void> {
            await super.replaceFile(before, after, id)
            controller.abort()
        }
    }
    await assert.rejects(new ProjectInitializer(new CancelledWriter(controller.signal), controller.signal).create(request(root)), error => {
        assert.ok(error instanceof Error && error.name === "AbortError")
        assert.match(error.message, /\.arrange\/initializations/)
        assert.match(error.message, /\.arrange\/transactions/)
        return true
    })
    assert.equal(JSON.parse(await readFile(resolve(root, "ui/package.json"), "utf8")).name, "starterplugin")
    await assert.rejects(readFile(resolve(root, "arrange.project.yaml")), { code: "ENOENT" })
    await assert.rejects(readFile(resolve(root, "native/CMakeLists.txt")), { code: "ENOENT" })
    for (const directory of ["initializations", "transactions"]) {
        const paths = await readdir(resolve(root, ".arrange", directory))
        assert.equal(paths.length, 1)
        const journal = JSON.parse(await readFile(resolve(root, ".arrange", directory, paths[0]), "utf8"))
        assert.equal(journal.status, "failed")
        if (directory === "transactions") assert.equal(journal.files[0].written, true)
    }
})

test("初始化确认后执行前取消不创建根目录，不生成虚假的恢复记录", async t => {
    const parent = await temporaryRoot(t)
    const controller = new AbortController()
    const initializer = new ProjectInitializer(new FileTransaction(controller.signal), controller.signal)
    const plan = await initializer.planCreate(request(resolve(parent, "project")))
    controller.abort()
    await assert.rejects(initializer.apply(plan), error => error === controller.signal.reason)
    assert.deepEqual(await readdir(parent), [])
})

test("完成首个子项目复制后取消，第二项目不开始并保留准确恢复路径", async t => {
    const parent = await temporaryRoot(t)
    const uiSource = resolve(parent, "ui-source")
    const nativeSource = resolve(parent, "native-source")
    await write(resolve(uiSource, "package.json"), "{}\n")
    await write(resolve(nativeSource, "CMakeLists.txt"), "project(OriginalTarget)\n")
    const state = createInitialProjectState(request(resolve(parent, "project")))
    const controller = new AbortController()
    class CancelledCopyInitializer extends ProjectInitializer {
        copies = 0
        protected override async copyDirectory(copy: CopyPlan): Promise<void> {
            await super.copyDirectory(copy)
            this.copies++
            controller.abort()
        }
    }
    const initializer = new CancelledCopyInitializer(new FileTransaction(controller.signal), controller.signal)
    await assert.rejects(initializer.adopt({ state, ui: { kind: "copy", sourceDir: uiSource }, native: { kind: "copy", sourceDir: nativeSource } }), error => error instanceof Error && error.name === "AbortError" && error.cause === controller.signal.reason && error.message.includes(resolve(state.rootDir, ".arrange/initializations")))
    assert.equal(initializer.copies, 1)
    assert.equal(await readFile(resolve(state.rootDir, "ui/package.json"), "utf8"), "{}\n")
    await assert.rejects(readdir(resolve(state.rootDir, "native")), { code: "ENOENT" })
    await assert.rejects(readFile(resolve(state.rootDir, "arrange.project.yaml")), { code: "ENOENT" })
    const paths = await readdir(resolve(state.rootDir, ".arrange/initializations"))
    const journal = JSON.parse(await readFile(resolve(state.rootDir, ".arrange/initializations", paths[0]), "utf8"))
    assert.equal(journal.status, "failed")
    assert.deepEqual(journal.copies.map((copy: { copied: boolean }) => copy.copied), [true, false])
})

test("递归复制中取消停止后续条目，保留部分内容和未完成复制记录", async t => {
    const parent = await temporaryRoot(t)
    const source = resolve(parent, "source")
    await write(resolve(source, "package.json"), "{}\n")
    await write(resolve(source, "src/a-first.ts"), "已复制内容")
    await write(resolve(source, "src/z-last.ts"), "不能继续复制")
    const state = createInitialProjectState(request(resolve(parent, "project")))
    const controller = new AbortController()
    Object.defineProperty(controller.signal, "throwIfAborted", {
        value() {
            if (existsSync(resolve(state.rootDir, "ui/src/a-first.ts"))) controller.abort()
            AbortSignal.prototype.throwIfAborted.call(this)
        }
    })
    const initializer = new ProjectInitializer(new FileTransaction(controller.signal), controller.signal)
    await assert.rejects(initializer.adopt({ state, ui: { kind: "copy", sourceDir: source }, native: { kind: "new" } }), error => error instanceof Error && error.name === "AbortError" && error.cause === controller.signal.reason)
    assert.equal(await readFile(resolve(state.rootDir, "ui/src/a-first.ts"), "utf8"), "已复制内容")
    await assert.rejects(readFile(resolve(state.rootDir, "ui/src/z-last.ts")), { code: "ENOENT" })
    await assert.rejects(readFile(resolve(state.rootDir, "arrange.project.yaml")), { code: "ENOENT" })
    const paths = await readdir(resolve(state.rootDir, ".arrange/initializations"))
    const journal = JSON.parse(await readFile(resolve(state.rootDir, ".arrange/initializations", paths[0]), "utf8"))
    assert.equal(journal.status, "failed")
    assert.equal(journal.copies[0].copied, false)
})

test("初始化复制中断保留已完成目录及精确接入记录，不伪称工程创建成功", async t => {
    const parent = await temporaryRoot(t)
    const uiSource = resolve(parent, "ui-source")
    const nativeSource = resolve(parent, "native-source")
    await write(resolve(uiSource, "package.json"), '{"name":"recoverable"}\n')
    await write(resolve(nativeSource, "CMakeLists.txt"), "project(OriginalTarget)\n")
    const state = createInitialProjectState(request(resolve(parent, "project")))
    const initializer = new ProjectInitializer(new FileTransaction())
    const plan = await initializer.planAdopt({ state, ui: { kind: "copy", sourceDir: uiSource }, native: { kind: "copy", sourceDir: nativeSource } })
    await rm(nativeSource, { recursive: true })
    await assert.rejects(initializer.apply(plan), /初始化未完成.*接入计划记录于/)
    assert.equal(await readFile(resolve(state.rootDir, "ui/package.json"), "utf8"), '{"name":"recoverable"}\n')
    await assert.rejects(readFile(resolve(state.rootDir, "arrange.project.yaml")), { code: "ENOENT" })
    const paths = await readdir(resolve(state.rootDir, ".arrange/initializations"))
    const journal = JSON.parse(await readFile(resolve(state.rootDir, ".arrange/initializations", paths[0]), "utf8"))
    assert.equal(journal.status, "failed")
    assert.deepEqual(journal.copies.map((copy: { copied: boolean }) => copy.copied), [true, false])
    assert.equal(journal.state.project.native.target, state.project.native.target)
    assert.ok(journal.files.includes(resolve(state.rootDir, "arrange.project.yaml")))
    assert.equal(await readFile(resolve(state.rootDir, ".arrange/.gitignore"), "utf8"), "*\n")
    assert.ok((await readdir(state.rootDir)).every(name => !name.startsWith(".arrange-copy-")))
})

test("非 TTY create/adopt 明确失败且不进入等待输入", async t => {
    const root = await temporaryRoot(t)
    for (const command of ["create", "adopt"]) await assert.rejects(promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), resolve(repoRoot, "cli/src/Entry.ts"), command], { cwd: root, timeout: 5000 }), error => {
        const result = error as Error & { code: number, stderr: string }
        assert.equal(result.code, 1)
        assert.match(result.stderr, /需要交互/)
        return true
    })
    assert.deepEqual(await readdir(root), [])
})
