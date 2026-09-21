import { effectScope } from '@arrange/framework'
import { FrameScheduler } from '../../packages/framework/src/runtime/scheduler.ts'
import { bindFrameScheduler } from '../../packages/framework/src/runtime/animationOwner.ts'

export function frameScope() {
    const scope = effectScope()
    const scheduler = new FrameScheduler(() => { })
    bindFrameScheduler(scope, scheduler)
    let time = 0
    return {
        scope,
        scheduler,
        run<T>(action: () => T): T { return scope.run(action)! },
        advanceBy(delay: number) {
            time += delay
            scheduler.prepare(time)
            scheduler.complete(true)
        },
        stop() {
            scope.stop()
            scheduler.dispose()
        },
    }
}
