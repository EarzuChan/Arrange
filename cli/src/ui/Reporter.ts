import type { Screen } from "./Screen.ts"
import { symbols } from "./Theme.ts"

// 交互层的持久消息：与 @clack/prompts 相同的引导线样式，经 Screen 输出，实时区域存在时写在它上方
export class Reporter {
    constructor(private readonly screen: Screen) { }

    intro(title: string): void {
        const { paint } = this.screen.palette
        this.screen.print(`${paint("gray", symbols.barStart)}  ${title}`)
    }

    outro(message: string): void {
        const { paint } = this.screen.palette
        this.screen.print([paint("gray", symbols.bar), `${paint("gray", symbols.barEnd)}  ${message}`, ""])
    }

    // 命令以失败结束
    fail(message: string): void {
        const { paint } = this.screen.palette
        this.screen.print([paint("gray", symbols.bar), ...this.indent(paint("gray", symbols.barEnd), message.split("\n").map(line => paint("red", line))), ""], "stderr")
    }

    step(message: string | readonly string[]): void { this.block(this.screen.palette.paint("green", symbols.step), message) }
    info(message: string | readonly string[]): void { this.block(this.screen.palette.paint("blue", symbols.info), message) }
    success(message: string | readonly string[]): void { this.block(this.screen.palette.paint("green", symbols.success), message) }
    warn(message: string | readonly string[]): void { this.block(this.screen.palette.paint("yellow", symbols.warn), message) }
    error(message: string | readonly string[]): void { this.block(this.screen.palette.paint("red", symbols.error), message, "stderr") }

    // 命令被取消（不是失败）
    cancelled(message: string): void {
        const { paint } = this.screen.palette
        this.screen.print([paint("gray", symbols.bar), `${paint("gray", symbols.barEnd)}  ${paint("yellow", message)}`, ""])
    }

    // 按语气选择符号的信息块（如扫描报告）：即使含有 Fatal 条目也是报告内容，写到标准输出
    toned(tone: "error" | "warn" | "info" | "step" | "success", message: string | readonly string[]): void {
        const { paint } = this.screen.palette
        const symbol = tone === "error" ? paint("red", symbols.error) : tone === "warn" ? paint("yellow", symbols.warn) : tone === "info" ? paint("blue", symbols.info) : tone === "success" ? paint("green", symbols.success) : paint("green", symbols.step)
        this.block(symbol, message)
    }

    block(symbol: string, message: string | readonly string[], stream: "stdout" | "stderr" = "stdout"): void {
        const lines = typeof message === "string" ? message.split("\n") : message
        this.screen.print([this.screen.palette.paint("gray", symbols.bar), ...this.indent(symbol, lines)], stream)
    }

    private indent(symbol: string, lines: readonly string[]): string[] {
        const bar = this.screen.palette.paint("gray", symbols.bar)
        return lines.map((line, index) => index === 0 ? `${symbol}  ${line}` : line ? `${bar}  ${line}` : bar)
    }
}
