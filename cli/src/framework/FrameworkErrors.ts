// registry 没有给出答案（连接失败、超时）与 registry 给出了否定答案（版本不存在、契约不兼容）是两回事：
// 前者无法判定兼容性，可以在已安装的 Framework 上回退验证；后者是确定的结论
export class RegistryUnreachableError extends Error {
    constructor(readonly registry: string, readonly reason: string, options?: { cause?: unknown }) {
        super(`无法连接 registry ${registry}：${reason}`, options)
        this.name = "RegistryUnreachableError"
    }

    withNote(note: string): RegistryUnreachableError {
        return new RegistryUnreachableError(this.registry, `${this.reason}；${note}`, { cause: this.cause })
    }
}

// Node 的 fetch 失败只给出 "fetch failed"，真实原因（ECONNREFUSED、ENOTFOUND、证书错误等）在 error.cause 里
export function describeFetchFailure(error: unknown): string {
    if (!(error instanceof Error)) return String(error)
    if (error.name === "TimeoutError") return "请求超时"
    const cause = error.cause
    if (cause instanceof Error) {
        const code = (cause as NodeJS.ErrnoException).code
        return code && !cause.message.includes(code) ? `${code}: ${cause.message}` : cause.message
    }
    return error.message
}
