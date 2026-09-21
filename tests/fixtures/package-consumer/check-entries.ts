import * as core from '@arrange/framework'
import { Text } from '@arrange/framework/foundation'
import { M, Modifier } from '@arrange/framework/ui'
import { animatedNumberAsRef, tween } from '@arrange/framework/animation'
import { ref as internalRef } from '@arrange/framework/internal'

if (core.ref !== internalRef || !(M instanceof Modifier) || !Text) throw new Error('发布包分层入口的运行时身份不一致')
for (const name of ['Text', 'Layout', 'M', 'Modifier', 'tween', 'defineArrangable', 'RearrangeSession', 'installArrangeHmrClient']) {
    if (Object.hasOwn(core, name)) throw new Error(`发布包根入口泄漏了 ${name}`)
}

if (typeof animatedNumberAsRef !== 'function' || tween().kind !== 'tween') throw new Error('发布包动画入口缺少正式能力')
