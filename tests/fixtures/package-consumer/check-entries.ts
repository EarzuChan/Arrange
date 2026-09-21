import * as core from '@arrange/framework'
import { Text } from '@arrange/framework/foundation'
import { M, Modifier } from '@arrange/framework/ui'
import { animatedNumberAsRef, createManualAnimationClock, tween } from '@arrange/framework/animation'
import { ref as internalRef } from '@arrange/framework/internal'

if (core.ref !== internalRef || !(M instanceof Modifier) || !Text) throw new Error('发布包分层入口的运行时身份不一致')
for (const name of ['Text', 'Layout', 'M', 'Modifier', 'tween', 'defineArrangable', 'RearrangeSession', 'installArrangeHmrClient']) {
    if (Object.hasOwn(core, name)) throw new Error(`发布包根入口泄漏了 ${name}`)
}

const target = core.ref(1)
const clock = createManualAnimationClock()
const value = animatedNumberAsRef(target, { clock, animationSpec: tween({ durationMillis: 10 }) })
target.value = 2
clock.advanceBy(10)
if (!core.isRef(value) || value.value !== 2) throw new Error('发布包动画与核心入口未共享响应式依赖追踪')
value.stop()
