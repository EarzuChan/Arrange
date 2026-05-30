export class ArrangeCliError extends Error {
    constructor(message: string, readonly details: Record<string, unknown> = {}) {
        super(message)
        this.name = "ArrangeCliError"
    }
}

export class ExternalCommandError extends Error {
    constructor(message: string, readonly command: string, readonly cwd: string, readonly exitCode?: number | null) {
        super(message)
        this.name = "ExternalCommandError"
    }
}

export function renderError(error: unknown): string {
    if (!(error instanceof Error)) return String(error)
    const lines = ["Arrange CLI failed.", "", error.stack ?? `${error.name}: ${error.message}`]
    if (error instanceof ExternalCommandError) {
        lines.push("", "External command:", `  command: ${error.command}`, `  cwd: ${error.cwd}`)
        if (error.exitCode !== undefined && error.exitCode !== null) lines.push(`  exitCode: ${error.exitCode}`)
    }
    return lines.join("\n")
}
