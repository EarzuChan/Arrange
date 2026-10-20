// 可正常结束阶段的共享能力契约，不包含终端或业务实现
export interface StopControl {
    readonly signal: AbortSignal
    enable(): void
    disable(): void
}
