import test from 'node:test'
import assert from 'node:assert/strict'
import * as core from '@arrange/framework'
import * as foundation from '@arrange/framework/foundation'
import * as ui from '@arrange/framework/ui'
import * as animation from '@arrange/framework/animation'
import * as internal from '@arrange/framework/internal'
import { frameScope } from './frameScope.ts'
import { requireSfaModule } from './sfaModules.ts'

test('根入口只保留核心能力，分层入口与编译协议共享响应式身份', () => {
    for (const name of ['Text', 'Layout', 'M', 'Modifier', 'tween', 'defineArrangable', 'callArrangable', 'RearrangeSession', 'getArrangeExecutionStats', 'installArrangeHmrClient']) assert.equal(Object.hasOwn(core, name), false, `根入口泄漏了 ${name}`)

    assert.equal(requireSfaModule('@arrange/framework/foundation'), foundation)
    assert.equal(requireSfaModule('@arrange/framework/ui'), ui)
    assert.equal(requireSfaModule('@arrange/framework/animation'), animation)
    assert.equal(requireSfaModule('@arrange/framework/internal'), internal)
    assert.throws(() => requireSfaModule('@arrange/framework/missing'), /测试未提供 SFA 依赖/)
    assert.equal(core.ref, internal.ref)
    assert.ok(ui.M instanceof ui.Modifier)

    const target = core.ref(1)
    const clock = frameScope()
    const value = clock.run(() => animation.animatedNumberAsRef(target, { animationSpec: animation.tween({ durationMillis: 10 }) }))
    assert.ok(core.isRef(value))
    target.value = 2
    clock.advanceBy(10)
    assert.equal(value.value, 2)
    clock.stop()
})
