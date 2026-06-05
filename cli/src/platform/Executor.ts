import { spawn } from "node:child_process"
import type { ProcessResult, ProcessSpec } from "./ProcessSpec.ts"

export class Executor {
    run(spec: ProcessSpec): Promise<ProcessResult> {
        // CHECK：这好吗？
        return new Promise((resolve, reject) => {
            const child = spawn(spec.command, spec.args, {
                cwd: spec.cwd,
                env: spec.env ? { ...process.env, ...spec.env } : process.env,
                shell: process.platform === "win32",
            })

            let stdout = ""
            let stderr = ""

            child.stdout?.on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8")
            })
            child.stderr?.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8")
            })
            child.on("error", reject)
            child.on("close", (exitCode) => {
                resolve({ exitCode: exitCode ?? 0, stdout, stderr })
            })
        })
    }
}
