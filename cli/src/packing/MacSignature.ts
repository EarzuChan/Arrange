export interface MacSignatureInfo {
    readonly kind: "unsigned" | "adhoc" | "identity"
    readonly details: string
    readonly entitlements: string
}

// 自动修复只接受无身份的本地签名；系统交互与此策略分开验证
export function assertAutomaticMacResign(signature: MacSignatureInfo, path: string): void {
    if (signature.kind === "identity") throw new Error(`加入 UI 后 macOS 身份签名失效：${path}。请在资源整理后使用原身份签名；不会自动替换为 ad-hoc。`)
    if (/linker-signed/i.test(signature.details) && signature.entitlements.trim()) throw new Error(`linker-signed bundle 带有 entitlements，不能安全自动重签：${path}`)
}
