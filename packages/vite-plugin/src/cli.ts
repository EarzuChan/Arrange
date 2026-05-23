#!/usr/bin/env node
import {spawn} from "node:child_process"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"

const vitePackage = await import("vite/package.json", {with: {type: "json"}})
const viteEntry = await import.meta.resolve("vite")
const viteBin = resolve(dirname(fileURLToPath(viteEntry)), "..", "..", vitePackage.default.bin.vite)
const nodeOptions = [process.env.NODE_OPTIONS, "--experimental-transform-types"].filter(Boolean).join(" ")
const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
    },
})

let forwardingSignal = false

function forwardSignal(signal: NodeJS.Signals): void {
    if (child.exitCode !== null || forwardingSignal) return
    forwardingSignal = true
    child.kill(signal)
    setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL")
    }, 5000).unref()
}

process.once("SIGINT", () => forwardSignal("SIGINT"))
process.once("SIGTERM", () => forwardSignal("SIGTERM"))

child.on("error", (error) => {
    throw error
})

child.on("exit", (code, signal) => {
    if (typeof code === "number") {
        process.exit(code)
        return
    }
    process.exit(signal ? 1 : 0)
})
