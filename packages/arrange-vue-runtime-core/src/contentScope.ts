import type { EffectScope, ReactiveEffect } from '@arrange/vue-reactivity'
import type { SchedulerJob } from './scheduler.ts'
import type { VNode } from './vnode.ts'

// 不创建 ArrangableInstance；生命周期归调用方，词法环境归内容闭包
export interface ContentScope {
    owner: VNode
    tree: VNode | null
    lifetime: EffectScope
    effect: ReactiveEffect
    job: SchedulerJob
}

export const contentBranchKey = Symbol('Arrange 条件内容身份')
