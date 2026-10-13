import { readNativeDependencies } from "../cli/src/source/NativeDependencies.ts"
import { SourceCache } from "../cli/src/source/SourceCache.ts"
import { GitSource } from "../cli/src/source/GitSource.ts"
import { UserDirectories } from "../cli/src/user/UserDirectories.ts"
import { Executor } from "../cli/src/platform/Executor.ts"
import { LineDecoder } from "../cli/src/ui/LineDecoder.ts"
import type { TaskOutput } from "../cli/src/ui/Tasks.ts"
import { repoRoot } from "./common.ts"
import { currentNativeSession } from "./native-session.ts"

export async function cachedNativeDefinitions(definitions: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>>> {
    const user = new UserDirectories()
    const { host, operations, signal } = currentNativeSession()
    const executor = new Executor(process.platform, signal, host)
    const cache = new SourceCache(user, new GitSource(executor), signal, operations)
    const log = (line: string) => console.log("[ArrangeNativeSource]", line)
    const task: TaskOutput = {
        title: "验收依赖源码", line: log, stage: text => { if (text) log(text) }, progress: () => { }, process: spec => {
            const decoders = { stdout: new LineDecoder(log), stderr: new LineDecoder(log) }
            return {
                ...spec, onOutput: (bytes, stream) => decoders[stream].push(bytes), onOutputEnd: () => {
                    decoders.stdout.flush()
                    decoders.stderr.flush()
                }
            }
        }
    }
    return operations.run([{ kind: "directory", path: user.sources, mode: "read" }], "准备验收依赖源码", async () => {
        const manifest = await readNativeDependencies(repoRoot)
        const result: Record<string, string> = { ...definitions }
        for (const [name, key, override] of [["juce", "FETCHCONTENT_SOURCE_DIR_JUCE", "JUCE_DIR"], ["quickjs_ng", "FETCHCONTENT_SOURCE_DIR_QUICKJS_NG", "ARRANGE_QUICKJS_NG_SOURCE_DIR"]] as const) {
            if (result[key] || result[override]) continue
            result[key] = (await cache.ensure(manifest[name], name === "juce" ? "JUCE" : "QuickJS-NG", task)).directory
        }
        return result
    })
}
