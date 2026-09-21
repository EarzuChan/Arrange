// 延迟的可见状态变化由宿主帧时钟推进，取消后不保留帧需求
export function scheduleFrameDeadline(delay: number, callback: () => void): () => void {
    if (!Number.isFinite(delay) || delay < 0) throw new Error('帧延迟必须是非负有限数值')

    const deadline = performance.now() + delay
    let active = true
    let handle = requestAnimationFrame(tick)

    function tick(timestamp: number) {
        if (!active) return

        if (timestamp >= deadline) {
            active = false
            callback()
        } else {
            handle = requestAnimationFrame(tick)
        }
    }

    return () => {
        if (!active) return

        active = false
        cancelAnimationFrame(handle)
    }
}