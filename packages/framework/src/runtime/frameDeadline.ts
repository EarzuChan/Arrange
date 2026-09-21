import { getCurrentScope, onScopeDispose } from '@arrange/reactivity'
import { animationScheduler } from './animationOwner.ts'
import type { FrameParticipant } from './scheduler.ts'

// 可见延迟由所属 Owner 的正式帧阶段推进，取消不保留帧需求
export function scheduleFrameDeadline(delay: number, callback: () => void): () => void {
    if (!Number.isFinite(delay) || delay < 0) throw new Error('帧延迟必须是非负有限数值')
    const owner = animationScheduler()
    const scope = getCurrentScope()
    const deadline = owner.now() + delay
    let pending = true
    const cancel = () => {
        pending = false
        owner.remove(participant)
    }
    const participant: FrameParticipant = {
        active: () => pending && (!scope || scope.active && !scope.paused),
        sample(time) {
            if (time < deadline) return
            cancel()
            callback()
        },
    }
    owner.add(participant)
    const wake = () => { if (pending) owner.wake() }
    const pause = () => owner.refresh()
    scope?.pauseCallbacks.add(pause)
    scope?.resumeCallbacks.add(wake)
    if (scope) onScopeDispose(() => {
        scope.resumeCallbacks.delete(wake)
        scope.pauseCallbacks.delete(pause)
        cancel()
    })
    return cancel
}
