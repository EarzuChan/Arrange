import { PassThrough } from "node:stream"
import { StringDecoder } from "node:string_decoder"

// 终端输入的唯一持有者。第一次需要输入时进入原始模式并一直保持到退出，期间不再切换模式：
// Windows 上在读取过程中切回行模式会留下一个阻塞在 ReadConsole、等回车才返回的读取，
// 之后的输入（按键、滚轮、光标位置应答）都会被它截住，进程退出时也会一直等它
// clack 提问读取 prompt 代理流（其 setRawMode 不触碰真实终端）；任务会话期间输入交给会话的解析器
// 两者都不在时丢弃输入，只把 Ctrl+C 转成中断

export interface InputStream extends NodeJS.ReadableStream {
    readonly isTTY?: boolean
    setRawMode?(mode: boolean): unknown
}

// 给 clack 使用的输入流：看起来是 TTY，原始模式开关只记录状态
export class PromptInput extends PassThrough {
    readonly isTTY = true
    isRaw = true

    setRawMode(mode: boolean): this {
        this.isRaw = mode
        return this
    }
}

const forcedExitPresses = 3

export class ConsoleInput {
    readonly prompt = new PromptInput()
    private opened = false
    private consumer: ((text: string) => void) | undefined
    private interrupts = 0
    private readonly decoder = new StringDecoder("utf8")
    private readonly dataListener = (chunk: Buffer | string): void => this.receive(typeof chunk === "string" ? chunk : this.decoder.write(chunk))
    private readonly exitListener = (): void => this.close()

    constructor(private readonly stdin: InputStream, private readonly onInterrupt: () => void = () => { process.emit("SIGINT", "SIGINT") }) {
        // 提问开始读取代理流时才接管终端输入
        this.prompt.on("resume", () => this.open())
    }

    get available(): boolean { return this.stdin.isTTY === true && typeof this.stdin.setRawMode === "function" }

    open(): boolean {
        if (this.opened || !this.available) return this.opened
        this.opened = true
        this.stdin.setRawMode!(true)
        this.stdin.on("data", this.dataListener)
        this.stdin.resume()
        process.on("exit", this.exitListener)
        return true
    }

    // 任务会话接管输入；返回的函数交还
    attach(consumer: (text: string) => void): () => void {
        this.open()
        this.consumer = consumer
        return () => {
            if (this.consumer === consumer) this.consumer = undefined
        }
    }

    // 原始模式下 Ctrl+C 不再产生 SIGINT：转成中断；连按三次强制退出，避免清理卡住时无法离开
    interrupt(): void {
        if (++this.interrupts >= forcedExitPresses) {
            this.close()
            process.exit(130)
        }
        this.onInterrupt()
    }

    // 退出前恢复终端：先停止读取，再退出原始模式
    close(): void {
        if (!this.opened) return
        this.opened = false
        this.stdin.off("data", this.dataListener)
        this.stdin.pause()
        try { this.stdin.setRawMode!(false) } catch { }
        process.off("exit", this.exitListener)
    }

    private receive(text: string): void {
        if (this.consumer) this.consumer(text)
        else if (this.prompt.readableFlowing) this.prompt.write(text)
        else if (text.includes("\x03")) this.interrupt()
    }
}
