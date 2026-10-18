import assert from "node:assert/strict"
import { cp, mkdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { MacBundleSigner } from "../src/feature/packing/MacBundleSigner.ts"
import { assertAutomaticMacResign } from "../src/feature/packing/MacSignature.ts"
import { Executor } from "../src/feature/platform/Executor.ts"
import type { ProcessSpec, ProcessResult } from "../src/feature/platform/ProcessSpec.ts"
import { isAbortError } from "../src/feature/platform/ProcessSpec.ts"
import { nativeProducts, macOnly } from "./native-fixture.ts"
import { write } from "./fixture.ts"

async function signedFixture(t: import("node:test").TestContext) {
    const { state, model } = await nativeProducts(t)
    const binary = model.targets.find(target => target.name.endsWith("_Standalone"))!.artifacts[0]!
    const original = join(binary, "../../..")
    const staged = join(state.rootDir, "staged.app")
    const entitlements = join(state.rootDir, "entitlements.plist")
    await write(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.arrange.test</key><true/></dict></plist>')
    const executor = new Executor()
    const signed = await executor.run({ command: "/usr/bin/codesign", args: ["--force", "--sign", "-", "--timestamp=none", "--identifier", "com.arrange.testproduct", "--entitlements", entitlements, original] })
    assert.equal(signed.exitCode, 0, signed.stderr)
    await cp(original, staged, { recursive: true })
    await write(join(staged, "Contents/Resources/ui/app.js"), "export default 'new UI'")
    return { original, staged, executor }
}

test("macOS 真实 codesign：加入 UI 后修复 ad-hoc，保留 identifier 和 entitlements", macOnly, async t => {
    const { original, staged, executor } = await signedFixture(t)
    const inspect = async (path: string) => {
        const result = await executor.run({ command: "/usr/bin/codesign", args: ["--display", "--entitlements", "-", path] })
        assert.equal(result.exitCode, 0, result.stderr)
        return result.stdout
    }
    const before = await inspect(original)
    await new MacBundleSigner(executor).ensureRunnable(original, staged)
    assert.equal(await inspect(staged), before)
    const verified = await executor.run({ command: "/usr/bin/codesign", args: ["--verify", "--deep", "--strict", staged] })
    assert.equal(verified.exitCode, 0, verified.stderr)
    const displayed = await executor.run({ command: "/usr/bin/codesign", args: ["--display", "--verbose=4", staged] })
    assert.match(displayed.stderr + displayed.stdout, /^Identifier=com.arrange.testproduct$/m)
    // 已有效时直接验证，不再次签名
    class RecordingExecutor extends Executor {
        calls: ProcessSpec[] = []
        override async run(spec: ProcessSpec) {
            this.calls.push(spec)
            return super.run(spec)
        }
    }
    const recording = new RecordingExecutor()
    await new MacBundleSigner(recording).ensureRunnable(original, staged)
    assert.ok(recording.calls.every(spec => !spec.args.includes("--sign")))
})

test("macOS 真实签名流程逐阶段取消，后续系统命令不执行", macOnly, async t => {
    const { original, staged } = await signedFixture(t)
    class CancellingExecutor extends Executor {
        calls = 0
        constructor(private readonly cancelAt: number) { super() }
        override async run(spec: ProcessSpec): Promise<ProcessResult> {
            this.calls++
            if (this.calls === this.cancelAt) return { exitCode: 130, stdout: "", stderr: "", cancelled: true, timedOut: false }
            return super.run(spec)
        }
    }
    for (let stage = 1; stage <= 7; stage++) {
        await rm(staged, { recursive: true })
        await cp(original, staged, { recursive: true })
        await mkdir(join(staged, "Contents/Resources/ui"), { recursive: true })
        await write(join(staged, "Contents/Resources/ui/app.js"), "export default 'changed'")
        const executor = new CancellingExecutor(stage)
        await assert.rejects(new MacBundleSigner(executor).ensureRunnable(original, staged), isAbortError)
        assert.equal(executor.calls, stage)
    }
    assert.ok((await readFile(join(original, "Contents/Info.plist"))).length > 0)
})

test("macOS 自动重签策略拒绝身份签名降级和带 entitlements 的 linker 签名", macOnly, () => {
    assert.throws(() => assertAutomaticMacResign({ kind: "identity", details: "", entitlements: "" }, "staged.app"), /身份签名失效/)
    assert.throws(() => assertAutomaticMacResign({ kind: "adhoc", details: "linker-signed", entitlements: "<plist/>" }, "staged.app"), /不能安全自动重签/)
    assert.doesNotThrow(() => assertAutomaticMacResign({ kind: "unsigned", details: "", entitlements: "" }, "staged.app"))
})

test("macOS 真实 unsigned bundle 自动签名并验证，签后损坏和丢失 entitlements 拒绝", macOnly, async t => {
    const { original, staged, executor } = await signedFixture(t)
    const removed = await executor.run({ command: "/usr/bin/codesign", args: ["--remove-signature", original] })
    assert.equal(removed.exitCode, 0, removed.stderr)
    await rm(staged, { recursive: true })
    await cp(original, staged, { recursive: true })
    await write(join(staged, "Contents/Resources/ui/app.js"), "export default 'unsigned UI'")
    await new MacBundleSigner(executor).ensureRunnable(original, staged)
    assert.equal((await executor.run({ command: "/usr/bin/codesign", args: ["--verify", "--deep", "--strict", staged] })).exitCode, 0)
    const signed = await signedFixture(t)
    class LoseEntitlements extends Executor {
        override run(spec: ProcessSpec) {
            return super.run(spec.args.includes("--sign") ? { ...spec, args: spec.args.filter(arg => !arg.startsWith("--preserve-metadata")) } : spec)
        }
    }
    await assert.rejects(new MacBundleSigner(new LoseEntitlements()).ensureRunnable(signed.original, signed.staged), /改变了 entitlements/)
    const corrupted = await signedFixture(t)
    class CorruptAfterSign extends Executor {
        override async run(spec: ProcessSpec) {
            const result = await super.run(spec)
            if (spec.args.includes("--sign") && result.exitCode === 0) await write(join(corrupted.staged, "Contents/Resources/ui/app.js"), "corrupted after codesign")
            return result
        }
    }
    await assert.rejects(new MacBundleSigner(new CorruptAfterSign()).ensureRunnable(corrupted.original, corrupted.staged), /签名验证失败/)
})
