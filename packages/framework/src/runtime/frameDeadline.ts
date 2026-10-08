import { getCurrentScope } from '@arrange/reactivity'
import { animationScheduler } from './animationOwner.ts'
import type { FrameParticipant } from './scheduler.ts'

// 可见延迟由所属 Owner 的正式帧阶段推进，取消不保留帧需求
export function scheduleFrameDeadline(delay: number, callback: () => void): () => void {
    if (!Number.isFinite(delay) || delay < 0) throw new Error('帧延迟必须是非负有限数值')
    const owner = animationScheduler()
    const scope = getCurrentScope()
    const deadline = owner.now() + delay
    let pending = true
    const wake = () => { if (pending) owner.wake() }
    const pause = () => owner.refresh()
    const cancel = () => {
        if (!pending) return
        pending = false
        owner.remove(participant)
        scope?.resumeCallbacks.delete(wake)
        scope?.pauseCallbacks.delete(pause)
        const index = scope?.cleanups.indexOf(cancel) ?? -1
        if (index >= 0) scope!.cleanups.splice(index, 1)
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
    scope?.pauseCallbacks.add(pause)
    scope?.resumeCallbacks.add(wake)
    scope?.cleanups.push(cancel)
    return cancel
}
