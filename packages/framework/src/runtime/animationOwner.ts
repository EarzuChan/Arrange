import { getCurrentScope, type EffectScope } from '@arrange/reactivity'
import { currentInstance } from './arrangable.ts'
import type { FrameScheduler } from './scheduler.ts'

const schedulers = new WeakMap<EffectScope, FrameScheduler>()

// 内部测试和无视图业务作用域显式关联 Owner，不提供用户逐帧循环 API
export function bindFrameScheduler(scope: EffectScope, scheduler: FrameScheduler): void { schedulers.set(scope, scheduler) }

export function findFrameScheduler(): FrameScheduler | undefined {
    if (currentInstance) return currentInstance.rearrangeSession.scheduler
    let scope = getCurrentScope()
    while (scope) {
        const scheduler = schedulers.get(scope)
        if (scheduler) return scheduler
        scope = scope.parent
    }
    return undefined
}

export function animationScheduler(): FrameScheduler {
    const scheduler = findFrameScheduler()
    if (!scheduler || !getCurrentScope()?.active) throw new Error('动画必须在已关联 UI Owner 的存活作用域中创建')
    return scheduler
}
