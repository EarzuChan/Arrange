import test from 'node:test'
import assert from 'node:assert/strict'
import * as core from '@arrange/framework'
import * as foundation from '@arrange/framework/foundation'
import * as ui from '@arrange/framework/ui'
import * as animation from '@arrange/framework/animation'
import * as internal from '@arrange/framework/internal'
import { frameScope } from './frameScope.ts'
import { requireSfaModule } from './sfaModules.ts'

test('分层入口、编译协议与动画通道共享响应式身份', () => {
    assert.equal(typeof core.Log, 'object')

    assert.equal(requireSfaModule('@arrange/framework/foundation'), foundation)
    assert.equal(requireSfaModule('@arrange/framework/ui'), ui)
    assert.equal(requireSfaModule('@arrange/framework/animation'), animation)
    assert.equal(requireSfaModule('@arrange/framework/internal'), internal)
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
