import {spawn} from "node:child_process"
import {once} from "node:events"
import {rmSync, writeFileSync} from "node:fs"
import {request} from "node:http"
import {createRequire} from "node:module"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"

const repoRoot = resolve(import.meta.dirname, "..")
const uiRoot = resolve(repoRoot, "demo/ui-src")
const port = 9178
const devBundlePath = "/@arrange/app.js"
const macroPattern = /\b__(?:DEV|TEST|BROWSER|SSR|GLOBAL|CJS|ESM_BROWSER|ESM_BUNDLER|COMPAT|FEATURE_[A-Z0-9_]+|VERSION)__\b/
const endpoint = `http://127.0.0.1:${port}${devBundlePath}`
const require = createRequire(import.meta.url)

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
    if (macroPattern.test(result.body)) {
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

const vitePackage = require("vite/package.json") as {bin: {vite: string} | string}
const viteEntry = await import.meta.resolve("vite")
const viteBinName = typeof vitePackage.bin === "string" ? vitePackage.bin : vitePackage.bin.vite
const viteBin = resolve(dirname(fileURLToPath(viteEntry)), "..", "..", viteBinName)
const configPath = resolve(uiRoot, `.arrange-demo-vite-${process.pid}-${Date.now()}.mjs`)
writeFileSync(configPath, [
    `import arrange from "@arrange/framework/vite"`,
    `export default { plugins: [arrange()] }`,
    "",
].join("\n"))

const child = spawn(process.execPath, ["--experimental-transform-types", viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--config", configPath], {
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
    rmSync(configPath, {force: true})
}
