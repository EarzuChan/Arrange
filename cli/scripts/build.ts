import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { rm, chmod } from "node:fs/promises"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const directory = resolve(import.meta.dirname, "..")
await rm(resolve(directory, "dist"), { recursive: true, force: true })
const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", resolve(directory, "tsconfig.build.json")], { cwd: directory, stdio: "inherit" })
if (result.error) throw result.error
if (result.status !== 0) process.exitCode = result.status ?? 1
else await chmod(resolve(directory, "dist/Entry.js"), 0o755)
