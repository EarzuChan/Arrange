#!/usr/bin/env node
const {spawnSync} = require("node:child_process")
const {createRequire} = require("node:module")
const {pathToFileURL} = require("node:url")
const {resolve} = require("node:path")

const requireFromHere = createRequire(__filename)
const tsxEntry = pathToFileURL(requireFromHere.resolve("tsx")).href
const cliEntry = resolve(__dirname, "../src/cli.ts")
const nodeOptions = [process.env.NODE_OPTIONS, "--import", tsxEntry].filter(Boolean).join(" ")
const result = spawnSync(process.execPath, ["--import", tsxEntry, cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
})

if (result.error) throw result.error
if (typeof result.status === "number") process.exit(result.status)
if (result.signal) process.kill(process.pid, result.signal)
