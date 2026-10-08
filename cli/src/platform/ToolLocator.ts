import { access, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, isAbsolute, join, resolve } from "node:path"

export function environmentValue(env: Record<string, string | undefined>, key: string): string | undefined {
    const actual = Object.keys(env).find(candidate => candidate.toLowerCase() === key.toLowerCase())
    return actual ? env[actual] : undefined
}

export async function locateTool(command: string, env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
    const paths = isAbsolute(command) || /[\\/]/.test(command) ? [resolve(command)] : (environmentValue(env, "PATH") ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean).map(directory => join(directory.replace(/^"|"$/g, ""), command))
    const suffixes = platform === "win32" && !/\.[A-Za-z0-9]+$/.test(command) ? ["", ...(environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";")] : [""]
    for (const path of paths) for (const suffix of suffixes) {
        const candidate = `${path}${suffix}`
        try {
            if (!(await stat(candidate)).isFile()) continue
            await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK)
            return candidate
        } catch { }
    }
    return undefined
}
