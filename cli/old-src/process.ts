import {spawn, spawnSync} from "node:child_process"
import {existsSync} from "node:fs"
import {extname, resolve} from "node:path"
import type {ResolvedToolchain} from "./local.ts"
import {ExternalCommandError} from "./errors.ts"

export type RunOptions = {
    cwd?: string
    env?: NodeJS.ProcessEnv
    allowFailure?: boolean
    toolchain?: ResolvedToolchain
    msvc?: boolean
    label?: string
}

export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<void> {
    const invocation = createInvocation(command, args, options)
    return new Promise((resolvePromise, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            stdio: "inherit",
            shell: false,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        })
        child.on("error", (error) => reject(new ExternalCommandError(formatSpawnError(error, invocation.display), invocation.display, options.cwd ?? process.cwd())))
        child.on("exit", (code) => {
            if (code === 0 || options.allowFailure) resolvePromise()
            else reject(new ExternalCommandError(`${invocation.display} failed with exit code ${code}.`, invocation.display, options.cwd ?? process.cwd(), code))
        })
    })
}

export function runForward(command: string, args: readonly string[], options: RunOptions = {}): Promise<void> {
    const invocation = createInvocation(command, args, options)
    return new Promise((resolvePromise, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            stdio: "inherit",
            shell: false,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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
        const onSigint = () => forwardSignal("SIGINT")
        const onSigterm = () => forwardSignal("SIGTERM")
        process.once("SIGINT", onSigint)
        process.once("SIGTERM", onSigterm)
        function cleanupSignals(): void {
            process.off("SIGINT", onSigint)
            process.off("SIGTERM", onSigterm)
        }
        child.on("error", (error) => {
            cleanupSignals()
            reject(new ExternalCommandError(formatSpawnError(error, invocation.display), invocation.display, options.cwd ?? process.cwd()))
        })
        child.on("exit", (code, signal) => {
            cleanupSignals()
            if (typeof code === "number" && code !== 0) reject(new ExternalCommandError(`${invocation.display} failed with exit code ${code}.`, invocation.display, options.cwd ?? process.cwd(), code))
            else if (signal) reject(new ExternalCommandError(`${invocation.display} was terminated by signal ${signal}.`, invocation.display, options.cwd ?? process.cwd()))
            else resolvePromise()
        })
    })
}

export function runQuiet(command: string, args: readonly string[], options: RunOptions = {}): Promise<void> {
    const invocation = createInvocation(command, args, options)
    return new Promise((resolvePromise, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            stdio: "ignore",
            shell: false,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        })
        child.on("error", (error) => reject(new ExternalCommandError(formatSpawnError(error, invocation.display), invocation.display, options.cwd ?? process.cwd())))
        child.on("exit", (code) => {
            if (code === 0 || options.allowFailure) resolvePromise()
            else reject(new ExternalCommandError(`${invocation.display} verification failed with exit code ${code}.`, invocation.display, options.cwd ?? process.cwd(), code))
        })
    })
}

export function runCaptureSync(command: string, args: readonly string[], options: RunOptions = {}): string | null {
    const invocation = createInvocation(command, args, options)
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        encoding: "utf8",
        shell: false,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    })
    if (result.error || result.status !== 0) return null
    return result.stdout
}

function createInvocation(command: string, args: readonly string[], options: RunOptions): {command: string; args: string[]; display: string; windowsVerbatimArguments: boolean} {
    const display = options.label ?? commandDisplay(command, args)
    const toolchain = options.toolchain
    if (process.platform === "win32") {
        if (options.msvc) {
            if (!toolchain?.msvc) throw new Error("Native commands require an MSVC environment, but arrange.local.yaml does not define windows.msvc.")
            return {
                command: toolchain.shellCommand,
                args: ["/d", "/s", "/c", commandLine([
                    "call",
                    toolchain.msvc.devCmd,
                    `-arch=${toolchain.msvc.arch}`,
                    `-host_arch=${toolchain.msvc.hostArch}`,
                    "&&",
                    command,
                    ...args,
                ])],
                display,
                windowsVerbatimArguments: true,
            }
        }
        if (isCmdLike(command)) {
            return {
                command: toolchain?.shellCommand ?? "cmd.exe",
                args: ["/d", "/s", "/c", commandLine([command, ...args])],
                display,
                windowsVerbatimArguments: true,
            }
        }
    }
    return {command, args: [...args], display, windowsVerbatimArguments: false}
}

function isCmdLike(command: string): boolean {
    const ext = extname(command).toLowerCase()
    return ext === ".cmd" || ext === ".bat"
}

function commandLine(parts: readonly string[]): string {
    return parts.map((part) => part === "&&" ? part : quoteCmd(part)).join(" ")
}

function quoteCmd(value: string): string {
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value
    return `"${value.replace(/"/g, '\\"')}"`
}

function commandDisplay(command: string, args: readonly string[]): string {
    return [command, ...args].join(" ")
}

function formatSpawnError(error: NodeJS.ErrnoException, display: string): string {
    if (error.code === "ENOENT") return `${display} failed to start: command or file not found. Check the tool path in arrange.local.yaml.`
    if (error.code === "EINVAL") return `${display} failed to start: invalid command line. Check tool paths and arguments in arrange.local.yaml.`
    if (error.code === "EACCES") return `${display} failed to start: permission denied. Check the tool path and file permissions.`
    return `${display} failed to start${error.code ? ` (${error.code})` : ""}. Check tool paths, permissions, and the local environment.`
}

export function platformArch(): string {
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform
    const arch = process.arch === "x64" ? "x64" : process.arch
    return `${platform}-${arch}`
}

export function pathExists(path: string): boolean {
    return existsSync(resolve(path))
}
