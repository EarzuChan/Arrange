import { createHash } from "node:crypto"
import { loadProjectIconSource } from "../asset/PngIcon.ts"
import { effectiveBundleId, effectiveDisplayName } from "./ProjectMetadata.ts"
import type { ProjectState } from "./ProjectState.ts"

// 准备记录与构建记录共用同一份资源身份，configure 成功不等于旧二进制已更新
export async function nativePresentationSignature(state: ProjectState, platform: "darwin" | "win32"): Promise<string> {
    const icon = await loadProjectIconSource(state)
    return createHash("sha256").update(JSON.stringify({
        displayName: effectiveDisplayName(state),
        bundleId: platform === "darwin" ? effectiveBundleId(state) : null,
        icon: icon ? { path: state.project.project.icon, fingerprint: icon.fingerprint } : null,
    })).digest("hex")
}
