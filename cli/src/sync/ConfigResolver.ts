import type {ProjectState} from "../project/ProjectState.ts"
import {readSnapshot, assertSnapshots, type FileSnapshot} from "../util/FileUtils.ts"
import {setJsonPath, type JsonValue} from "../managed/JsonRegion.ts"
import type {TextCluster} from "../managed/TextCluster.ts"
import type {TextRegion} from "../managed/TextRegion.ts"
import {ConfigWriter} from "./ConfigWriter.ts"
import type {ConfigTarget, ConfigScanReport, ResolvableIssue} from "./ConfigScanReport.ts"
import type {SyncWizard} from "../wizard/Sync.ts"

export type ResolveChoice = "create" | "wrap" | "marker" | "edit" | "abort"
type TextElement = TextCluster | TextRegion

// THINKING：这个Resolve的实现有点化简——把所有的情形先混为一谈，再分类产出方——而不是干干净净的先产出方再看类型。虽然说能跑。。。

export class ConfigResolver {
    private readonly writer = new ConfigWriter()

    constructor(private readonly syncWizard: SyncWizard) {}

    async resolve(state: ProjectState, report: ConfigScanReport, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan" | "ready-to-apply"> {
        if (report.fatal.length) return "abort"

        const issue = report.resolvable[0]
        if (!issue) return "ready-to-apply"

        return issue.cause === "damaged" ? this.resolveDamaged(issue) : this.resolveMissing(state, issue, guards)
    }

    private async resolveDamaged(issue: ResolvableIssue): Promise<"abort" | "rescan"> {
        const choice = await this.choose(issue, ["edit", "abort"])

        if (choice === "abort") return "abort"

        return await this.syncWizard.edit(`请编辑 ${issue.target.path}，修复：${issue.message}`) ? "rescan" : "abort"
    }

    private async resolveMissing(state: ProjectState, issue: ResolvableIssue, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan"> {
        const textElement = this.textElement(issue.target)

        if (textElement) return this.resolveMissingText(state, issue, textElement, guards)

        if (issue.target.region?.kind === "json-region") return this.resolveMissingJson(state, issue, guards)

        return this.resolveMissingFile(state, issue, guards)
    }

    private async resolveMissingText(state: ProjectState, issue: ResolvableIssue, textElement: TextElement, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan"> {
        const choice = await this.choose(issue, ["wrap", "marker", "abort"])
        if (choice === "abort") return "abort"
        if (choice === "wrap") return await this.wrapExisting(issue, textElement)
        return this.insertMarker(state, issue, textElement, guards)
    }

    private async wrapExisting(issue: ResolvableIssue, textElement: TextElement): Promise<"abort" | "rescan"> {
        const instructions = `请在 ${issue.target.path} 的已有内容前后各加一行：\n${textElement.wrapper.begin}\n原有内容\n${textElement.wrapper.end}`
        return await this.syncWizard.edit(instructions) ? "rescan" : "abort"
    }

    private async insertMarker(state: ProjectState, issue: ResolvableIssue, textElement: TextElement, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan"> {
        const target = issue.target
        const instructions = `请在 ${target.path} 的${target.region ? "所属 Cluster inner" : "文件"}中新建位置放一行：\n${textElement.wrapper.marker}`
        if (!await this.syncWizard.edit(instructions)) return "abort"
        try { await assertSnapshots(guards) } catch { return "rescan" }
        const before = await readSnapshot(target.path)
        if (before.content === null) return "rescan"

        const parent = this.markerParent(state, target, before.content)
        if (!parent) return "rescan"
        if (textElement.locate(state, parent.text).kind !== "missing") return "rescan"
        const marker = textElement.wrapper.locateMarker(parent.text)
        if (!marker) {
            this.syncWizard.message("未找到唯一 Marker，请检查位置与拼写。")
            return "rescan"
        }
        if (!this.markerIsAtDirectParent(parent.text, marker.start)) return "rescan"

        const start = parent.offset + marker.start
        const end = parent.offset + marker.end
        const after = before.content.slice(0, start) + textElement.make(state) + before.content.slice(end)
        await this.writer.write(state.rootDir, [{before, after}], guards)
        return "rescan"
    }

    private markerParent(state: ProjectState, target: ConfigTarget, content: string): {text: string, offset: number} | undefined {
        if (!target.region || !target.cluster) return {text: content, offset: 0}
        const location = target.cluster.locate(state, content)
        if (location.kind !== "located") return undefined
        return {text: content.slice(location.inner.start, location.inner.end), offset: location.inner.start}
    }

    private markerIsAtDirectParent(parent: string, markerStart: number): boolean {
        const stack: string[] = []

        for (const match of parent.slice(0, markerStart).matchAll(/^[\t ]*# arrange:(begin|end) ([\w:.-]+)[\t ]*\r?$/gm)) {
            if (match[1] === "begin") stack.push(match[2])
            else if (stack.pop() !== match[2]) {
                this.syncWizard.message("Marker 前的 Wrapper 边界损坏，请先修复。")
                return false
            }
        }

        if (stack.length) {
            this.syncWizard.message("Marker 位于其他元素内部，请移到所属父级的直接正文中。")
            return false
        }

        return true
    }

    private async resolveMissingJson(state: ProjectState, issue: ResolvableIssue, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan"> {
        const choice = await this.choose(issue, ["create", "abort"])
        if (choice === "abort") return "abort"
        return this.createJsonRegion(state, issue.target, guards)
    }

    private async createJsonRegion(state: ProjectState, target: ConfigTarget, guards: readonly FileSnapshot[]): Promise<"rescan"> {
        try { await assertSnapshots(guards) } catch { return "rescan" }
        const before = target.snapshot
        if (before.content === null || target.region?.kind !== "json-region") return "rescan"
        const json = JSON.parse(before.content) as JsonValue
        setJsonPath(json, target.region.locate(state), target.region.make(state))
        await this.writer.write(state.rootDir, [{before, after: `${JSON.stringify(json, null, 2)}\n`}], guards)
        return "rescan"
    }

    private async resolveMissingFile(state: ProjectState, issue: ResolvableIssue, guards: readonly FileSnapshot[]): Promise<"abort" | "rescan"> {
        const choice = await this.choose(issue, ["create", "abort"])
        if (choice === "abort") return "abort"
        try { await assertSnapshots(guards) } catch { return "rescan" }
        await this.writer.write(state.rootDir, [{before: issue.target.snapshot, after: issue.target.file.make(state)}], guards)
        return "rescan"
    }

    private textElement(target: ConfigTarget): TextElement | undefined {
        const element = target.region ?? target.cluster
        return element?.kind === "text-region" || element?.kind === "text-cluster" ? element : undefined
    }

    private async choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice> {
        const choice = await this.syncWizard.choose(issue, choices)
        if (choice === "abort") return "abort"
        if (!choices.includes(choice)) throw new Error("无效的恢复选项")
        return choice
    }
}
