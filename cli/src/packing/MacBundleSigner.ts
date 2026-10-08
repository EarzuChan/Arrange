import type { Executor } from "../platform/Executor.ts"
import { throwIfProcessCancelled } from "../platform/ProcessSpec.ts"
import { toolProbeTimeoutMs } from "../CliMetadata.ts"

interface SignatureInfo {
    readonly kind: "unsigned" | "adhoc" | "identity"
    readonly details: string
    readonly entitlements: string
}

export class MacBundleSigner {
    constructor(private readonly executor: Executor) { }

    private async inspect(path: string): Promise<SignatureInfo> {
        const result = await this.executor.run({ command: "/usr/bin/codesign", args: ["--display", "--verbose=4", path], timeoutMs: toolProbeTimeoutMs })
        throwIfProcessCancelled(result)
        const details = result.stdout + result.stderr
        if (result.exitCode !== 0) {
            if (/not signed at all/i.test(details)) return { kind: "unsigned", details, entitlements: "" }
            throw new Error(`无法读取 macOS 签名：${path}\n${details}`)
        }
        const kind = /Signature=adhoc/i.test(details) ? "adhoc" : "identity"
        const entitlements = await this.executor.run({ command: "/usr/bin/codesign", args: ["--display", "--entitlements", "-", path], timeoutMs: toolProbeTimeoutMs })
        throwIfProcessCancelled(entitlements)
        if (entitlements.exitCode !== 0) throw new Error(`无法读取 macOS entitlements：${path}\n${entitlements.stderr}`)
        return { kind, details, entitlements: entitlements.stdout }
    }

    async ensureRunnable(original: string, staged: string): Promise<void> {
        const signature = await this.inspect(original)
        const verification = await this.executor.run({ command: "/usr/bin/codesign", args: ["--verify", "--deep", "--strict", staged], timeoutMs: toolProbeTimeoutMs })
        throwIfProcessCancelled(verification)
        if (verification.exitCode === 0) return
        if (signature.kind === "identity") throw new Error(`加入 UI 后 macOS 身份签名失效：${staged}。请在资源整理后使用原身份签名；不会自动替换为 ad-hoc。`)
        if (/linker-signed/i.test(signature.details) && signature.entitlements.trim()) throw new Error(`linker-signed bundle 带有 entitlements，不能安全自动重签：${staged}`)
        const args = ["--force", "--sign", "-", "--timestamp=none"]
        if (signature.kind === "adhoc") args.push("--preserve-metadata=identifier,entitlements,flags,runtime")
        const identifier = signature.details.match(/^Identifier=(.+)$/m)?.[1]
        if (identifier) args.push("--identifier", identifier)
        args.push(staged)
        const signed = await this.executor.run({ command: "/usr/bin/codesign", args, timeoutMs: toolProbeTimeoutMs })
        throwIfProcessCancelled(signed)
        if (signed.exitCode !== 0) throw new Error(`macOS 本地签名失败：${staged}\n${signed.stderr}`)
        const after = await this.inspect(staged)
        if (identifier && after.details.match(/^Identifier=(.+)$/m)?.[1] !== identifier) throw new Error(`macOS 重签改变了 signing identifier：${staged}`)
        if (signature.entitlements.trim() !== after.entitlements.trim()) throw new Error(`macOS 重签改变了 entitlements：${staged}`)
        const checked = await this.executor.run({ command: "/usr/bin/codesign", args: ["--verify", "--deep", "--strict", staged], timeoutMs: toolProbeTimeoutMs })
        throwIfProcessCancelled(checked)
        if (checked.exitCode !== 0) throw new Error(`macOS 本地签名验证失败：${staged}\n${checked.stderr}`)
    }
}
