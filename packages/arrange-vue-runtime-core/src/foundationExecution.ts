import { shallowReadonly } from '@arrange/vue-reactivity'
import { getCurrentInstance, type ArrangableInstance, type Data } from './arrangable.ts'
import { getFoundationDefinition, type FoundationContext } from './apiDefineFoundationArrangable.ts'
import { renderSlot } from './helpers/renderSlot.ts'
import { validateArrangableOptions, type ArrangableOptions } from './arrangableOptions.ts'
import { createVNode } from './vnode.ts'

export function initializeFoundation(instance: ArrangableInstance): boolean {
    const definition = getFoundationDefinition(instance.type)
    if (!definition) return false

    const props = shallowReadonly(instance.props)
    const assertActive = () => {
        if (getCurrentInstance() !== instance || instance.isUnmounted) throw new Error('Foundation 结构入口只能在所属实现执行期间使用')
    }
    const assertSlot = (name: string) => {
        assertActive()
        if (!definition.slotNames.includes(name)) throw new TypeError(`Foundation 未声明内容入口：${name}`)
    }
    const context: FoundationContext<Data, readonly string[]> = {
        props,
        call(target, inputs, slots) {
            assertActive()
            if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('Foundation 调用必须指向 Arrangable 定义')
            validateArrangableOptions(target as ArrangableOptions)
            if (!getFoundationDefinition(target) && typeof (target as ArrangableOptions).setup !== 'function' && typeof (target as ArrangableOptions).render !== 'function') throw new TypeError('Foundation 调用目标缺少 Arrangable 实现')
            const invocation = createVNode(target, inputs, slots)
            return invocation
        },
        slot(name) { assertSlot(name); return instance.slots[name] ?? (() => []) },
        content(name, key) { assertSlot(name); return renderSlot(instance.slots, name, key) },
        source(name) { return instance.vnode.valueSources?.[name]?.source },
    }

    instance.render = () => {
        return definition.implement(context)
    }
    return true
}
