import {setJsonPath, type JsonValue} from "../managed/JsonRegion.ts"
import type {ConfigScanReport, ApplicableUpdate} from "./ConfigScanReport.ts"
import {ConfigWriter, type FileChange} from "./ConfigWriter.ts"
import type {FileSnapshot} from "../util/FileUtils.ts"

export class ConfigApplier {
    readonly writer = new ConfigWriter()

    async apply(rootDir: string, report: ConfigScanReport, guards: readonly FileSnapshot[] = []): Promise<void> {
        if (report.fatal.length || report.resolvable.length) throw new Error("CONFIG 仍有阻塞，不能 Apply")
        const byFile = new Map<string, ApplicableUpdate[]>()
        for (const update of report.applicable) byFile.set(update.target.path, [...(byFile.get(update.target.path) ?? []), update])
        const changes: FileChange[] = []
        for (const updates of byFile.values()) {
            const before = updates[0].target.snapshot
            if (before.content === null || updates.some(update => update.target.snapshot.content !== before.content)) throw new Error("更新基于不同文件快照")
            let after = before.content
            if (updates.every(update => update.kind === "text")) {
                const sorted = updates.sort((a, b) => b.span.start - a.span.start)
                let boundary = after.length
                for (const update of sorted) {
                    if (update.span.end > boundary || update.span.start < 0 || update.span.end < update.span.start || after.slice(update.span.start, update.span.end) !== update.actual) throw new Error("Region 更新区间重叠或已失效")
                    after = after.slice(0, update.span.start) + update.expected + after.slice(update.span.end)
                    boundary = update.span.start
                }
            } else if (updates.every(update => update.kind === "json")) {
                const json = JSON.parse(after) as JsonValue
                // 数组元素从后向前处理，避免删除引起后续下标漂移。
                updates.sort((a, b) => typeof a.jsonPath.at(-1) === "number" && typeof b.jsonPath.at(-1) === "number" ? Number(b.jsonPath.at(-1)) - Number(a.jsonPath.at(-1)) : 0)
                for (const update of updates) setJsonPath(json, update.jsonPath, update.expected)
                const indent = before.content.match(/\n([\t ]+)"/)?.[1] ?? "  "
                after = `${JSON.stringify(json, null, indent)}\n`
                if (before.content.includes("\r\n")) after = after.replace(/\n/g, "\r\n")
            } else throw new Error("同一文件混用了文本和 JSON 更新")
            changes.push({before, after})
        }
        await this.writer.write(rootDir, changes, guards)
    }
}
