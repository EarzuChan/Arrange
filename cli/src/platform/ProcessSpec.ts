export interface ProcessSpec {
    readonly command: string
    readonly args: string[]
    readonly cwd?: string
    readonly env?: Record<string, string>
}

export interface ProcessResult {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
}
