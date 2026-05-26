import {writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

function parseArgs(rawArgs: string[]): {command: "dev" | "build" | "vite"; viteArgs: string[]} {
    const [rawCommand, ...rest] = rawArgs
    if (!rawCommand || rawCommand === "dev") return {command: "dev", viteArgs: rest}
    if (rawCommand === "build") return {command: "build", viteArgs: rest}
    if (rawCommand === "vite") return {command: "vite", viteArgs: rest}
    if (rawCommand === "--help" || rawCommand === "-h") {
        console.log(`Arrange CLI\n\nUsage:\n  arrange dev [vite args...]\n  arrange build [vite args...]\n  arrange vite [...args]\n`)
        process.exit(0)
    }
    return {command: "vite", viteArgs: rawArgs}
}

const arrangeViteEntry = await import.meta.resolve("@arrange/framework/vite")

function arrangeConfigFile(): string {
    const configPath = join(tmpdir(), `arrange-vite-${process.pid}-${Date.now()}.mjs`)
    writeFileSync(configPath, [
        `import arrange from ${JSON.stringify(arrangeViteEntry)}`,
        `export default { plugins: [arrange()] }`,
        "",
    ].join("\n"))
    return configPath
}

function normalizeArgs(args: string[]): string[] {
    const parsed = parseArgs(args)
    if (parsed.command === "vite") return parsed.viteArgs

    const configArgs = ["--config", arrangeConfigFile()]
    if (parsed.command === "dev") {
        return ["--host", "127.0.0.1", "--port", "9178", "--strictPort", ...configArgs, ...parsed.viteArgs]
    }
    return ["build", ...configArgs, ...parsed.viteArgs]
}

export {normalizeArgs, parseArgs}
