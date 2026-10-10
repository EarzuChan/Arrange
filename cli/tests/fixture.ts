import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import type { TestContext } from "node:test"
import type { ProjectState } from "../src/project/ProjectState.ts"
import { ProjectStateStore } from "../src/project/ProjectStateStore.ts"
import { FileTransaction } from "../src/util/FileTransaction.ts"
import { configRegistry } from "../src/config/ConfigRegistry.ts"
import type { ResolveChoice } from "../src/sync/ConfigResolver.ts"
import type { ConfigInteraction } from "../src/sync/ConfigInteraction.ts"
import type { ConfigScanReport, ResolvableIssue } from "../src/sync/ConfigScanReport.ts"
import { Writable } from "node:stream"
import { createTerminal, type CliTerminal } from "../src/ui/Terminal.ts"
import type { TaskOutput } from "../src/ui/Tasks.ts"
import { LineDecoder } from "../src/ui/LineDecoder.ts"

// 非 TTY 的输出汇：测试里收集界面输出，不写到真实终端
export class OutputSink extends Writable {
    text = ""
    override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.text += chunk.toString()
        callback()
    }
}

export function quietTerminal(): CliTerminal & { readonly output: OutputSink } {
    const output = new OutputSink()
    return { ...createTerminal({ out: output, err: output }), output }
}

export interface RecordedTask extends TaskOutput {
    readonly lines: string[]
    readonly stages: (string | undefined)[]
    readonly progresses: [number, number][]
}

// 记录型任务输出：子进程输出按真实规则逐行解码后收集，供断言
export function testTask(title = "test"): RecordedTask {
    const task: RecordedTask = {
        title,
        lines: [],
        stages: [],
        progresses: [],
        line(text) { task.lines.push(text) },
        stage(text) { task.stages.push(text) },
        progress(done, total) { task.progresses.push([done, total]) },
        process(spec, parser) {
            const sink = (line: string): void => {
                task.line(line)
                parser?.(line, task)
            }
            const decoders = { stdout: new LineDecoder(sink), stderr: new LineDecoder(sink) }
            return {
                ...spec, stdio: "capture", retainOutput: false, onOutput: (chunk, stream) => decoders[stream].push(chunk), onOutputEnd: () => {
                    decoders.stdout.flush()
                    decoders.stderr.flush()
                }
            }
        },
    }
    return task
}

export function stateFor(rootDir: string): ProjectState {
    return { rootDir, project: { project: { name: "TestPlugin", version: "1.0.0", vendorName: "Test Vendor", vendorCode: "Test", pluginCode: "TstP", products: ["standalone", "vst3"] }, framework: { version: "0.0.0-m.2.2" }, ui: { directory: "ui", packageManager: "npm" }, native: { directory: "native", target: "TestPlugin", pluginType: "effect" }, artifacts: { directory: "artifacts", includeVersionDirectory: true }, "managed-items": configRegistry.items.map(item => item.id) }, local: null }
}

export async function fixture(t: TestContext, generate = true): Promise<ProjectState> {
    const root = await mkdtemp(join(tmpdir(), "arrange-config-test-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const state = stateFor(root)
    await new ProjectStateStore(new FileTransaction()).save(state)
    if (generate) for (const file of configRegistry.files) await write(file.path(state), file.make(state))
    return state
}

export async function write(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, "utf8")
}

export class TestSyncWizard implements ConfigInteraction {
    readonly reports: ConfigScanReport[] = []
    readonly messages: string[] = []
    readonly failures: string[] = []
    choices = 0
    onChoose: (issue: ResolvableIssue, choices: readonly ResolveChoice[]) => Promise<ResolveChoice> = async () => "abort"
    onEdit: (instructions: string) => Promise<boolean> = async () => false
    report(report: ConfigScanReport): void { this.reports.push(report) }
    async choose(issue: ResolvableIssue, choices: readonly ResolveChoice[]): Promise<ResolveChoice> {
        this.choices++
        return this.onChoose(issue, choices)
    }
    async edit(instructions: string): Promise<boolean> { return this.onEdit(instructions) }
    message(message: string): void { this.messages.push(message) }
    failure(message: string): void { this.failures.push(message) }
}
