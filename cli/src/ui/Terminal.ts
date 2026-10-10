import type { Readable, Writable } from "node:stream"
import { ConsoleInput, type InputStream } from "./ConsoleInput.ts"
import { Reporter } from "./Reporter.ts"
import { Screen, type ScreenStream } from "./Screen.ts"
import type { TaskRunner } from "./Tasks.ts"
import { TerminalTaskRunner } from "./TerminalTasks.ts"

// clack 提问使用的输入输出：输入是控制台输入的代理流，不直接触碰终端模式
export interface PromptIo {
    readonly input: Readable
    readonly output: Writable
}

// 交互层的唯一输出通道：持久消息（Reporter）、实时任务（TaskRunner）与提问共用同一块屏幕和同一个输入持有者
export interface CliTerminal {
    readonly screen: Screen
    readonly reporter: Reporter
    readonly tasks: TaskRunner
    readonly prompt: PromptIo
    // 恢复终端输入模式；进程退出前调用
    close(): void
}

export interface TerminalStreams {
    readonly out?: ScreenStream
    readonly err?: ScreenStream
    readonly input?: InputStream
}

export function createTerminal(streams: TerminalStreams = {}): CliTerminal {
    const out = streams.out ?? process.stdout
    const stdin = streams.input ?? process.stdin
    const screen = new Screen(out, streams.err ?? process.stderr)
    const consoleInput = new ConsoleInput(stdin)
    return {
        screen,
        reporter: new Reporter(screen),
        tasks: new TerminalTaskRunner(screen, consoleInput),
        // 非交互环境（测试与程序化调用）没有原始模式可接管，提问直接读原始输入流
        prompt: { input: consoleInput.available ? consoleInput.prompt : stdin as unknown as Readable, output: out as unknown as Writable },
        close: () => consoleInput.close(),
    }
}
