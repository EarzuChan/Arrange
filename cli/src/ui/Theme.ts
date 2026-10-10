import { styleText } from "node:util"
import { S_BAR, S_BAR_END, S_BAR_H, S_BAR_START, S_CORNER_BOTTOM_LEFT, S_CORNER_BOTTOM_RIGHT, S_CORNER_TOP_LEFT, S_CORNER_TOP_RIGHT, S_ERROR, S_INFO, S_STEP_CANCEL, S_STEP_SUBMIT, S_SUCCESS, S_WARN, unicode } from "@clack/prompts"

// 与 @clack/prompts 共用同一套符号和配色，交互提问与任务输出在同一条引导线上
export const symbols = {
    bar: S_BAR,
    barStart: S_BAR_START,
    barEnd: S_BAR_END,
    horizontal: S_BAR_H,
    cornerTopLeft: S_CORNER_TOP_LEFT,
    cornerTopRight: S_CORNER_TOP_RIGHT,
    cornerBottomLeft: S_CORNER_BOTTOM_LEFT,
    cornerBottomRight: S_CORNER_BOTTOM_RIGHT,
    step: S_STEP_SUBMIT,
    info: S_INFO,
    success: S_SUCCESS,
    warn: S_WARN,
    error: S_ERROR,
    cancel: S_STEP_CANCEL,
    progressFull: unicode ? "━" : "=",
    progressHead: unicode ? "╸" : ">",
    progressEmpty: unicode ? "─" : "-",
    ellipsis: unicode ? "…" : "...",
    arrowUp: unicode ? "↑" : "^",
    arrowDown: unicode ? "↓" : "v",
} as const

export const spinnerFrames = unicode ? ["◒", "◐", "◓", "◑"] : ["•", "o", "O", "0"]
export const spinnerIntervalMs = unicode ? 80 : 120

type Format = Parameters<typeof styleText>[0]

// 由调用方决定是否着色：实时区域只在 TTY 中绘制，持久输出按目标流的能力决定
export interface Palette {
    paint(format: Format, text: string): string
}

export const colorPalette: Palette = { paint: (format, text) => styleText(format, text, { validateStream: false }) }
export const plainPalette: Palette = { paint: (_format, text) => text }

export function paletteFor(stream: { readonly isTTY?: boolean, hasColors?(): boolean }): Palette {
    if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return plainPalette
    if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return colorPalette
    return stream.isTTY && (stream.hasColors?.() ?? true) ? colorPalette : plainPalette
}

export function formatDuration(milliseconds: number): string {
    const seconds = Math.max(0, milliseconds) / 1000
    if (seconds < 10) return `${seconds.toFixed(1)}s`
    if (seconds < 60) return `${Math.floor(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const rest = Math.floor(seconds % 60)
    return minutes < 60 ? `${minutes}m${String(rest).padStart(2, "0")}s` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`
}
