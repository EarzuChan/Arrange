import {spawn} from "node:child_process"
import {once} from "node:events"
import {request} from "node:http"
import {resolve} from "node:path"
import {ARRANGE_VUE_MACRO_PATTERN, DEV_BUNDLE_PATH} from "../packages/vite-plugin/src/constraints.ts"

const repoRoot = resolve(import.meta.dirname, "..")
const uiRoot = resolve(repoRoot, "demo/ui-src")
const port = 9178
const endpoint = `http://127.0.0.1:${port}${DEV_BUNDLE_PATH}`

function fetchText(url: string): Promise<{status: number; body: string; headers: Record<string, string | string[] | undefined>}> {
    return new Promise((resolvePromise, reject) => {
        const req = request(url, (res) => {
            let body = ""
            res.setEncoding("utf8")
            res.on("data", (chunk) => {
                body += chunk
            })
            res.on("end", () => {
                resolvePromise({status: res.statusCode ?? 0, body, headers: res.headers})
            })
        })
        req.on("error", reject)
        req.end()
    })
}

async function probeEndpoint(): Promise<{status: number; body: string; headers: Record<string, string | string[] | undefined>} | null> {
    try {
        return await fetchText(endpoint)
    } catch {
        return null
    }
}

function assertBundle(result: {status: number; body: string; headers: Record<string, string | string[] | undefined>}): void {
    if (result.status !== 200) throw new Error(`unexpected dev endpoint status ${result.status}\n${result.body}`)
    if (!/createApp/.test(result.body)) throw new Error("dev endpoint bundle missing createApp")
    if (ARRANGE_VUE_MACRO_PATTERN.test(result.body)) {
        throw new Error("dev endpoint bundle contains unresolved Arrange Vue macro")
    }
    if (/process\.env/.test(result.body)) throw new Error("dev endpoint bundle contains process.env")
    console.log(`dev endpoint ok: ${result.status}, bytes=${result.body.length}`)
}

const existing = await probeEndpoint()
if (existing) {
    assertBundle(existing)
    process.exit(0)
}

const cliPath = resolve(repoRoot, "packages/vite-plugin/src/cli.ts")
const child = spawn(process.execPath, ["--experimental-transform-types", cliPath], {
    cwd: uiRoot,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
})

let output = ""
child.stdout?.on("data", (chunk) => {
    output += chunk.toString()
})
child.stderr?.on("data", (chunk) => {
    output += chunk.toString()
})

try {
    const deadline = Date.now() + 20000
    let result: Awaited<ReturnType<typeof probeEndpoint>> = null
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`dev server exited early with ${child.exitCode}\n${output}`)
        result = await probeEndpoint()
        if (result) break
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    }
    if (!result) throw new Error(`timed out waiting for dev endpoint\n${output}`)
    assertBundle(result)
} finally {
    if (child.exitCode === null) {
        child.kill("SIGTERM")
        await Promise.race([
            once(child, "exit"),
            new Promise((resolvePromise) => setTimeout(resolvePromise, 8000)),
        ])
    }
    if (child.exitCode === null) child.kill("SIGKILL")
}
