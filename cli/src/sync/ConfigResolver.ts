import type {ProjectState} from "../project/ProjectState.ts"
import {readSnapshot, assertSnapshots, type FileSnapshot} from "../util/FileUtils.ts"
import {setJsonPath, type JsonValue} from "../managed/JsonRegion.ts"
import {ConfigWriter} from "./ConfigWriter.ts"
import type {ConfigScanReport} from "./ConfigScanReport.ts"
import type {SyncWizard} from "../wizard/config.ts"

export type ResolveChoice = "create" | "wrap" | "marker" | "edit" | "abort"
export class ConfigResolver {
    constructor(readonly syncWizard: SyncWizard, readonly writer = new ConfigWriter()) {}

    async resolve(state: ProjectState, report: ConfigScanReport, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan" | "ready-to-apply"> {
        if (report.fatal.length) return "abort"
        const issue = report.resolvable[0]

        if (!issue) return "ready-to-apply"
        const {target} = issue
        const element = target.region ?? target.cluster
        const textElement = element?.kind === "text-region" || element?.kind === "text-cluster" ? element : undefined
        const choices: ResolveChoice[] = issue.cause === "damaged" ? ["edit", "abort"] : textElement ? ["wrap", "marker", "abort"] : ["create", "abort"]
        const choice = await this.syncWizard.choose(issue, choices)

        if (choice === "abort") return "abort"
        if (!choices.includes(choice)) throw new Error("无效的恢复选项")
        if (choice === "edit") return await this.syncWizard.edit(`请编辑 ${target.path}，修复：${issue.message}`) ? "rescan" : "abort"
        if (choice === "wrap" || choice === "marker") {
            if (!textElement) throw new Error("当前对象没有文本 Wrapper")
            const instructions = choice === "wrap" ? `请在 ${target.path} 的已有内容前后各加一行：\n${textElement.wrapper.begin}\n原有内容\n${textElement.wrapper.end}` : `请在 ${target.path} 的${target.region ? "所属 Cluster inner" : "文件"}中新建位置放一行：\n${textElement.wrapper.marker}`
            if (!await this.syncWizard.edit(instructions)) return "abort"
            if (choice === "wrap") return "rescan"
            try { await assertSnapshots(guards) } catch { return "rescan" }
            const before = await readSnapshot(target.path)
            if (before.content === null) return "rescan"
            let parent = before.content
            let offset = 0
            if (target.region && target.cluster) {
                const location = target.cluster.locate(state, before.content)
                if (location.kind !== "located") return "rescan"
                offset = location.inner.start
                parent = parent.slice(location.inner.start, location.inner.end)
            }
            // 已存在或损坏的同名 Wrapper 必须先由用户修好，不能叠加。
            if (textElement.locate(state, parent).kind !== "missing") return "rescan"
            const marker = textElement.wrapper.locateMarker(parent)
            if (!marker) { this.syncWizard.message("未找到唯一 Marker，请检查位置与拼写。"); return "rescan" }
            const stack: string[] = []
            for (const match of parent.slice(0, marker.start).matchAll(/^[\t ]*# arrange:(begin|end) ([\w:.-]+)[\t ]*\r?$/gm)) {
                if (match[1] === "begin") stack.push(match[2])
                else if (stack.pop() !== match[2]) { this.syncWizard.message("Marker 前的 Wrapper 边界损坏，请先修复。"); return "rescan" }
            }
            if (stack.length) { this.syncWizard.message("Marker 位于其他元素内部，请移到所属父级的直接正文中。"); return "rescan" }
            const start = offset + marker.start
            const end = offset + marker.end
            const after = before.content.slice(0, start) + textElement.make(state) + before.content.slice(end)
            await this.writer.write(state.rootDir, [{before, after}], guards)
            return "rescan"
        }
        try { await assertSnapshots(guards) } catch { return "rescan" }
        if (!element) {
            await this.writer.write(state.rootDir, [{before: target.snapshot, after: target.file.make(state)}], guards)
        } else if (element.kind === "json-region") {
            const before = target.snapshot
            if (before.content === null) return "rescan"
            const json = JSON.parse(before.content) as JsonValue
            setJsonPath(json, element.locate(state), element.make(state))
            await this.writer.write(state.rootDir, [{before, after: `${JSON.stringify(json, null, 2)}\n`}], guards)
        }
        return "rescan"
    }
}
