import { OperationHost } from "../cli/src/operation/OperationHost.ts"
import { Operations } from "../cli/src/operation/Operations.ts"
import { UserDirectories } from "../cli/src/user/UserDirectories.ts"
import { ProjectRegistry } from "../cli/src/user/ProjectRegistry.ts"
import { resolve } from "node:path"
import { repoRoot } from "./common.ts"
import { Executor } from "../cli/src/platform/Executor.ts"
import { throwIfProcessCancelled } from "../cli/src/platform/ProcessSpec.ts"
import type { ProcessSpec } from "../cli/src/platform/ProcessSpec.ts"

let session: { host: OperationHost, operations: Operations, signal: AbortSignal, builds: Set<string> } | undefined
export function currentNativeSession() {
    if (!session) throw new Error("缺少原生验收操作会话")
    return session
}

export async function withNativeSession(body: () => Promise<void>, builds: readonly string[]): Promise<void> {
    if (session) return body()
    const user = new UserDirectories()
    const host = new OperationHost(user)
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    const signal = AbortSignal.any([controller.signal, host.failureSignal])
    const operations = new Operations(host, signal, message => console.log("[ArrangeNativeSession]", message))
    session = { host, operations, signal, builds: new Set(builds.map(path => resolve(path))) }
    process.on("SIGINT", interrupt)
    process.on("SIGTERM", interrupt)
    try { await operations.run([{ kind: "directory", path: user.dependencySources, mode: "read" }, ...builds.map(path => ({ kind: "directory" as const, path: resolve(path), mode: "write" as const }))], "原生验收", body) } finally {
        session = undefined
        try {
            await host.close()
        } finally {
            process.removeListener("SIGINT", interrupt)
            process.removeListener("SIGTERM", interrupt)
        }
    }
}

export async function claimNativeVerification(build: string): Promise<void> {
    if (!session) throw new Error("原生验收必须在完整操作会话中执行")
    const directory = resolve(build)
    if (!session.builds.has(directory)) throw new Error(`验收构建树未在会话开始前声明：${directory}`)
    await session.operations.assert([{ kind: "directory", path: directory, mode: "write" }])
    await new ProjectRegistry(new UserDirectories(), session.signal).register(repoRoot, undefined, directory)
}

export function nativeSessionStart(spec: ProcessSpec) {
    const session = currentNativeSession()
    return new Executor(process.platform, session.signal, session.host).start(spec)
}

export async function nativeSessionRun(command: string, args: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const session = currentNativeSession()
    const variables = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    const result = await new Executor(process.platform, session.signal, session.host).run({ command, args, cwd: repoRoot, env: variables, stdio: "inherit" })
    throwIfProcessCancelled(result)
    if (result.exitCode !== 0) throw new Error(`${command} 执行失败，退出码 ${result.exitCode}`)
}
