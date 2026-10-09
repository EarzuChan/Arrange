import { defaultBundleIdPrefix, defaultGeneratedBundleIdPrefix } from "../CliMetadata.ts"

interface DisplayNameState {
    readonly project: { readonly project: { readonly name: string, readonly displayName?: string } }
}

interface BundleIdState {
    readonly project: {
        readonly project: { readonly bundleId?: string, readonly vendorCode: string }
        readonly native: { readonly target: string }
    }
}

export function effectiveDisplayName(state: DisplayNameState): string {
    return state.project.project.displayName ?? state.project.project.name
}

export function effectiveBundleId(state: BundleIdState): string {
    const metadata = state.project.project
    return metadata.bundleId ?? `${defaultBundleIdPrefix}.${metadata.vendorCode.toLowerCase()}.${state.project.native.target.replace(/[^A-Za-z0-9.-]/g, "-")}`
}

export function generateDefaultBundleId(input: { readonly vendorName: string, readonly vendorCode: string, readonly projectName: string }): string {
    const manufacturer = asciiComponent(input.vendorName) || input.vendorCode.toLowerCase()
    return `${defaultGeneratedBundleIdPrefix}.${manufacturer}.${asciiComponent(input.projectName)}`
}

export function validateBundleId(value: string): string | undefined {
    const label = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    return !/\s/.test(value) && new RegExp(`^${label}(?:\\.${label})+$`).test(value) ? undefined : "Bundle ID 须使用点分隔的 reverse-DNS 标识，仅含 ASCII 字母、数字与段内连字符"
}

export function validateDisplayName(value: string): string | undefined {
    if (!value.trim()) return "显示名称不能为空"
    if (/[\p{Cc}<>:"/\\|?*]/u.test(value)) return "显示名称不得包含控制字符或跨平台文件名禁用字符"
    if (/[. ]$/.test(value)) return "显示名称不得以点或空格结尾"
    if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(value)) return "显示名称不得使用 Windows 保留文件名"
    return undefined
}

export function validateIconPath(value: string): string | undefined {
    if (!value || /^[\\/]|^[A-Za-z]:/.test(value) || value.includes("\\")) return "图标须使用工程根内的相对 PNG 路径，以 '/' 分隔目录"
    const parts = value.split("/")
    if (parts.some(part => !part || part === "." || part === ".." || validateDisplayName(part))) return "图标路径不得包含空段、'.'、'..' 或非法文件名"
    if (!/\.png$/i.test(value)) return "图标源文件必须为 PNG"
    return undefined
}

function asciiComponent(value: string): string {
    return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase()
}
