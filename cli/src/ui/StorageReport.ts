import type { StorageItem } from "../storage/StorageFacts.ts"
import type { InspectionFact, InspectionState } from "../util/RecordInspection.ts"
import { formatFileSize } from "./FileSize.ts"

const states: Record<InspectionState, string> = { ready: "正常", missing: "丢失", damaged: "损坏", incompatible: "版本不兼容", unavailable: "无法访问或验证", unknown: "无法确认", replaced: "身份失效", stale: "未准备或已过期", incomplete: "未完成" }
const kinds: Record<StorageItem["kind"], string> = { project: "工程登记", build: "构建目录", "deps-src": "依赖源码", temporary: "依赖源码获取暂存" }
const labels: Record<StorageItem["facts"][number]["label"], string> = { record: "记录", content: "内容", ownership: "归属", project: "工程", preparation: "准备", index: "索引", transaction: "事务", occupancy: "占用" }
function describe(check: InspectionFact): string { return `${states[check.state]} · ${check.reason}\n  ${check.path}` }

export function describeStorageItem(item: StorageItem): string {
    const size = item.kind === "project" ? "" : ` · ${item.sizeComplete ? "" : "至少 "}${formatFileSize(item.bytes)}`
    const lines = [`${kinds[item.kind]} · ${item.id}${size}`, `路径：${item.path}`]
    for (const fact of item.facts) lines.push(`${labels[fact.label]}：${describe(fact.check)}`)
    if (item.kind !== "project") {
        lines.push(`引用：${item.references.complete ? item.references.paths.length ? "已确认" : "已确认无引用" : "检查不完整"}`)
        for (const path of item.references.paths) lines.push(`  ${path}`)
        for (const blocker of item.references.blockers) lines.push(`  阻断：${describe(blocker)}`)
        lines.push(`清理：${item.cleanup.allowed ? "可清理" : "不可自动清理"} · ${item.cleanup.reason}`)
        if (item.kind === "deps-src") lines.push(`修复：${item.repairable ? "可按确切 commit 重新获取，相关准备状态将失效" : "不可自动修复，检查记录、内容及引用阻断原因"}`)
    }
    return lines.join("\n")
}

export function describeCleanupBlockers(items: readonly StorageItem[]): string[] {
    return items.filter(item => !item.cleanup.allowed).map(item => `${item.id} · ${item.cleanup.reason}${item.facts.filter(fact => fact.check.state !== "ready").map(fact => `\n${labels[fact.label]}：${describe(fact.check)}`).join("")}${item.references.blockers.map(check => `\n引用阻断：${describe(check)}`).join("")}`)
}
