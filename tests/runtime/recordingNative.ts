import type { NativeTransactionTarget, NativeModifierHandle } from '../../packages/runtime/src/native.ts'
import { Modifier, type ModifierElement } from '../../packages/runtime/src/modifier.ts'

export interface RecordedLayoutNode {
    readonly id: number
    readonly type: string
    readonly inputs: Map<string, unknown>
    readonly children: number[]
    modifiers: NativeModifierHandle[]
}

export function recordingNative(autoApply = true) {
    let nodes = new Map<number, RecordedLayoutNode>()
    let bindings = new Map<bigint, { id: number; input: string }>()
    let candidate: Map<number, RecordedLayoutNode> | undefined
    let candidateBindings: typeof bindings | undefined
    let completion: ((error?: string) => void) | undefined
    let identity = 1n
    let submissions = 0
    let writes = 0
    const live = () => {
        if (!candidate) throw new Error('原生操作必须属于候选事务')
        return candidate
    }
    const node = (id: number) => {
        const result = live().get(id)
        if (!result) throw new Error(`布局节点不存在：${id}`)
        return result
    }
    const finish = (error?: string) => {
        if (!completion) throw new Error('当前没有待应用事务')
        const callback = completion
        completion = undefined
        if (!error) {
            nodes = candidate!
            bindings = candidateBindings!
        }
        candidate = undefined
        candidateBindings = undefined
        callback(error)
    }
    const target: NativeTransactionTarget = {
        beginRearrange() {
            if (candidate) throw new Error('候选事务不能重入')
            candidate = new Map([...nodes].map(([id, value]) => [id, { ...value, inputs: new Map(value.inputs), children: [...value.children], modifiers: [...value.modifiers] }]))
            candidateBindings = new Map(bindings)
        },
        submitRearrange(callback) {
            submissions++
            completion = callback
            if (autoApply) finish()
        },
        abortRearrange() { candidate = undefined; candidateBindings = undefined; completion = undefined },
        createNode(id, type) {
            if (live().has(id)) throw new Error(`布局节点身份重复：${id}`)
            live().set(id, { id, type, inputs: new Map(), children: [], modifiers: [] })
        },
        deleteNode(id) {
            const pending = [id]
            while (pending.length) {
                const current = pending.pop()!
                pending.push(...node(current).children)
                live().delete(current)
                for (const [handle, binding] of candidateBindings!) if (binding.id === current) candidateBindings!.delete(handle)
            }
        },
        insertChild(parent, child, index) {
            node(child)
            for (const parent of live().values()) {
                const previous = parent.children.indexOf(child)
                if (previous >= 0) parent.children.splice(previous, 1)
            }
            node(parent).children.splice(index, 0, child)
        },
        removeChild(parent, child) {
            const children = node(parent).children
            const index = children.indexOf(child)
            if (index < 0) throw new Error('移除目标不属于该父节点')
            children.splice(index, 1)
        },
        registerBinding(id, input) {
            node(id)
            const handle = { identity: identity++, generation: 1n }
            candidateBindings!.set(handle.identity, { id, input })
            return handle
        },
        updateBinding(handle, value) {
            const binding = candidateBindings!.get(handle.identity)
            if (!binding) throw new Error('拒绝已退休绑定')
            const owner = node(binding.id)
            if (binding.input.startsWith('实例:')) {
                const identity = BigInt(binding.input.slice(3))
                const index = owner.modifiers.findIndex(handle => handle.identity === identity)
                if (index < 0) throw new Error('Modifier 实例已退休')
                const elements = [...(owner.inputs.get('modifier') as Modifier).elements]
                elements[index] = value as ModifierElement
                owner.inputs.set('modifier', new Modifier(elements))
            } else {
                owner.inputs.set(binding.input, value)
                if (binding.input === 'modifier') owner.modifiers = (value as Modifier).elements.map((element, index) => {
                    const previous = owner.modifiers[index]
                    const kind = element.type === 'absoluteOffset' ? 'offset' : element.type
                    return previous?.kind === kind && previous.key === (element.key ?? '') ? previous : { identity: identity++, generation: 1n, kind, key: element.key ?? '' }
                })
            }
            writes++
        },
        modifierInstances(id) { return nodes.get(id)?.modifiers ?? [] },
        registerModifierBinding(id, instance) {
            if (!node(id).modifiers.some(handle => handle.identity === instance.identity && handle.generation === instance.generation)) throw new Error('Modifier 实例不属于受体')
            const handle = { identity: identity++, generation: 1n }
            candidateBindings!.set(handle.identity, { id, input: `实例:${instance.identity}` })
            return handle
        },
        releaseBinding(handle) { candidateBindings!.delete(handle.identity) },
        unmount() { nodes.clear(); bindings.clear(); target.abortRearrange() },
    }
    return {
        target,
        finish,
        get nodes() { return nodes },
        get submissions() { return submissions },
        get writes() { return writes },
        textNodes() {
            const result: { id: number; text: string }[] = []
            const pending = nodes.has(1) ? [1] : []
            while (pending.length) {
                const value = nodes.get(pending.pop()!)!
                for (const element of (value.inputs.get('modifier') as Modifier | undefined)?.elements ?? []) {
                    if (element.type === 'text') result.push({ id: value.id, text: String(element.value.text) })
                    if (element.type === 'textField') result.push({ id: value.id, text: String(element.value.value) })
                }
                pending.push(...[...value.children].reverse())
            }
            return result
        },
    }
}
