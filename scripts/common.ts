import {spawn} from "node:child_process"
import type {SpawnOptions} from "node:child_process"
import {existsSync} from "node:fs"
import {resolve} from "node:path"

export const repoRoot = resolve(import.meta.dirname, "..")

export function cmakeExe(): string {
    const candidates = [
        process.env.CMAKE_EXE,
        "D:/Microsoft Visual Studio/18/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
    ].filter((candidate): candidate is string => Boolean(candidate))
    return candidates.find((candidate) => existsSync(candidate)) ?? "cmake"
}

export function ninjaExe(): string {
    const candidates = [
        process.env.NINJA_EXE,
        "D:/Microsoft Visual Studio/18/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe",
        "D:/CLion 2026.1/bin/ninja/win/x64/ninja.exe",
    ].filter((candidate): candidate is string => Boolean(candidate))
    return candidates.find((candidate) => existsSync(candidate)) ?? "ninja"
}

export function vsDevCmd(): string | null {
    const candidates = [
        process.env.VSDEVCMD,
        "D:/Microsoft Visual Studio/18/BuildTools/Common7/Tools/VsDevCmd.bat",
    ].filter((candidate): candidate is string => Boolean(candidate))
    return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function run(command: string, args: readonly string[] = [], options: SpawnOptions = {}): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd: repoRoot,
            stdio: "inherit",
            shell: false,
            ...options,
        })
        child.on("error", reject)
        child.on("exit", (code) => {
            if (code === 0) resolvePromise()
            else reject(new Error(`${command} exited with ${code}`))
        })
    })
}

export function runInVsDev(command: string): Promise<void> {
    const devCmd = vsDevCmd()
    const nmakeDir = "D:\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Tools\\MSVC\\14.50.35717\\bin\\Hostx64\\x64"
    const ninjaDir = resolve(ninjaExe(), "..")
    const windowsKitBin = "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64"
    const toolPath = [nmakeDir, ninjaDir, windowsKitBin].filter((candidate) => existsSync(candidate)).join(";")
    const commandLine = devCmd
        ? `call ${quoteCmd(devCmd)} -arch=x64 -host_arch=x64 && set "PATH=${toolPath};%PATH%" && ${command}`
        : command
    return run("cmd.exe", ["/d", "/c", commandLine], {windowsVerbatimArguments: true})
}

export function configureSmokeBuild(buildDir: string): Promise<void> {
    const quickJsDirArg = process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR
        ? ` -DARRANGE_QUICKJS_NG_SOURCE_DIR="${process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR}"`
        : ""
    return runInVsDev(
        `"${cmakeExe()}" -S . -B ${buildDir} -G Ninja -DCMAKE_MAKE_PROGRAM="${ninjaExe()}" `
        + `-DCMAKE_BUILD_TYPE=Debug -DARRANGE_WITH_QUICKJS_NG=ON -DARRANGE_BUILD_TESTS=ON${quickJsDirArg}`,
    )
}

function quoteCmd(value: string): string {
    const normalized = String(value).replaceAll("/", "\\")
    return `"${normalized}"`
}
