#!/usr/bin/env node
import {spawn} from "node:child_process"
import {createRequire} from "node:module"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"

import {normalizeArgs} from "./cli-core.ts"

const require = createRequire(import.meta.url)

type VitePackage = {bin: {vite: string} | string}

const vitePackage = require("vite/package.json") as VitePackage
const viteEntry = await import.meta.resolve("vite")
const viteBinName = typeof vitePackage.bin === "string" ? vitePackage.bin : vitePackage.bin.vite
const viteBin = resolve(dirname(fileURLToPath(viteEntry)), "..", "..", viteBinName)
const tsxEntry = await import.meta.resolve("tsx")
const nodeOptions = [process.env.NODE_OPTIONS, "--import", tsxEntry].filter(Boolean).join(" ")
const child = spawn(process.execPath, [viteBin, ...normalizeArgs(process.argv.slice(2))], {
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
