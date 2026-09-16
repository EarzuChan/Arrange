import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, dirname} from "node:path"
import type {TestContext} from "node:test"
import type {ProjectState} from "../src/project/ProjectState.ts"
import {ProjectStateStore} from "../src/project/ProjectStateStore.ts"
import {managedFiles, managedItems} from "../src/managed/ManagedDefinitions.ts"
import type {ResolveChoice} from "../src/sync/ConfigResolver.ts"
import {SyncWizard} from "../src/wizard/config.ts"
import type {ConfigScanReport, ResolvableIssue} from "../src/sync/ConfigScanReport.ts"

export function stateFor(rootDir: string): ProjectState {
    return {rootDir, project: {project: {name: "TestPlugin", version: "1.0.0", vendorName: "Test Vendor", vendorCode: "Test", pluginCode: "TstP", products: ["standalone", "vst3"]}, framework: {version: "0.0.0-m.2.2"}, ui: {directory: "ui", packageManager: "npm"}, native: {directory: "native", pluginType: "effect"}, artifacts: {directory: "artifacts", includeVersionDirectory: true}, "managed-items": managedItems.map(item => item.id)}, local: null}
}

export async function fixture(t: TestContext, generate = true): Promise<ProjectState> {
    const root = await mkdtemp(join(tmpdir(), "arrange-config-test-"))
    t.after(() => rm(root, {recursive: true, force: true}))
    const state = stateFor(root)
    await new ProjectStateStore().save(state)
    if (generate) for (const file of managedFiles) await write(file.path(state), file.make(state))
    return state
}

export async function write(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), {recursive: true})
    await writeFile(path, content, "utf8")
}

export class TestSyncWizard extends SyncWizard {
    readonly reports: ConfigScanReport[] = []
    readonly messages: string[] = []
    choices = 0
    onChoose: (issue: ResolvableIssue, choices: readonly ResolveChoice[]) => Promise<ResolveChoice> = async () => "abort"
    onEdit: (instructions: string) => Promise<boolean> = async () => false
    override report(report: ConfigScanReport): void { this.reports.push(report) }
    override async choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice> { this.choices++; return this.onChoose(issue, choices) }
    override async edit(instructions: string): Promise<boolean> { return this.onEdit(instructions) }
    override message(message: string): void { this.messages.push(message) }
}
