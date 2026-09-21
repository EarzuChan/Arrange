import type { ArrangableInstance } from '@arrange/vue-runtime-core/internal'
import type { CompositionHost, RearrangeNode } from '@arrange/vue-runtime-core/internal'
import type { NativeBindingHandle, NativeModifierHandle, NativeMutation, NativeTransactionTarget } from './native.ts'
import { Modifier, modifierStats, type ModifierElement } from './modifier.ts'
import type { MeasurePolicy } from './measurePolicy.ts'
import { arrangeExecutionStats } from '@arrange/vue-runtime-core/internal'

export class NativeComposition implements CompositionHost {
    private nextId = 2
    private roots: readonly LayoutRearrangeNode[] = []
    private operations: NativeMutation[] = []
    private commits: (() => void)[] = []
    private aborts: (() => void)[] = []
    private rootCreated = false
    private preparing = false
    private applying = false
    private nativeOpen = false
    private transaction: object | undefined

    constructor(readonly native: NativeTransactionTarget) {}

    allocateId(): number { return this.nextId++ }

    begin(): void {
        if (this.preparing || this.applying) throw new Error('原生候选提交不能重入')
        this.preparing = true

        if (!this.rootCreated) {
            this.operations.push(native => { native.createNode(1, 'Root'); arrangeExecutionStats.nativeCreateOperations++ })
            this.commits.push(() => { this.rootCreated = true })
        }
    }

    onCommit(action: () => void): void { this.commits.push(action) }
    onAbort(action: () => void): void { this.aborts.push(action) }

    stage(operation: NativeMutation, commit?: () => void, abort?: () => void): void {
        this.operations.push(operation)
        if (commit) this.commits.push(commit)
        if (abort) this.aborts.push(abort)
    }

    reconcileRoots(nodes: readonly RearrangeNode[]): void {
        const roots = nodes as readonly LayoutRearrangeNode[]
        this.reconcile(1, this.roots, roots)
        this.commits.push(() => { this.roots = roots })
    }

    reconcile(parent: number, previous: readonly LayoutRearrangeNode[], next: readonly LayoutRearrangeNode[]): void {
        const retained = new Set(next)
        for (const node of previous) {
            if (retained.has(node)) continue
            this.stage(native => {
                native.removeChild(parent, node.id)
                native.deleteNode(node.id)
                arrangeExecutionStats.nativeRemoveOperations++
            })
        }
        const order = previous.filter(node => retained.has(node))
        for (let index = 0; index < next.length; index++) {
            const node = next[index]
            if (order[index] === node) continue
            const old = order.indexOf(node)
            if (old >= 0) order.splice(old, 1)
            order.splice(index, 0, node)
            this.stage(native => { native.insertChild(parent, node.id, index); arrangeExecutionStats.nativeInsertOperations++ })
        }
    }

    apply(complete: (error?: Error) => void): void {
        if (!this.preparing) throw new Error('没有可提交的重排候选')
        this.preparing = false
        this.applying = true
        const transaction = this.transaction = {}
        try {
            this.native.beginRearrange()
            this.nativeOpen = true
            for (const operation of this.operations) operation(this.native)
            this.native.submitRearrange(message => {
                if (this.transaction !== transaction) return
                this.nativeOpen = false
                if (message) {
                    complete(new Error(message))
                    return
                }
                this.transaction = undefined
                const commits = this.commits.splice(0)
                this.operations.length = 0
                this.aborts.length = 0
                this.applying = false
                const errors: unknown[] = []
                for (const commit of commits) {
                    try { commit() } catch (error) { errors.push(error) }
                }
                try { complete() } catch (error) { errors.push(error) }
                if (errors.length) throw new AggregateError(errors, '原生已提交，但提交后清理或通知发生错误')
            })
        } catch (error) {
            if (this.transaction === transaction) this.rollback()
            throw error
        }
    }

    rollback(): void {
        this.transaction = undefined
        const errors: unknown[] = []
        const safely = (operation: () => void) => { try { operation() } catch (error) { errors.push(error) } }
        try {
            if (this.nativeOpen) safely(() => this.native.abortRearrange())
            for (let index = this.aborts.length - 1; index >= 0; index--) safely(this.aborts[index])
        } finally {
            this.nativeOpen = false
            this.operations.length = 0
            this.commits.length = 0
            this.aborts.length = 0
            this.preparing = false
            this.applying = false
        }
        if (errors.length) throw new AggregateError(errors, '原生候选撤销时发生错误')
    }
}

// 此类的唯一构造调用位于 Layout setup，普通定义不接入节点应用层
export class LayoutRearrangeNode implements RearrangeNode {
    id: number
    children: readonly LayoutRearrangeNode[] = []
    private retired = false
    private attached = true
    private readonly bindings = new Map<string, NativeBindingHandle>()
    private readonly inputs = new Map<string, unknown>()
    private readonly pendingInputs = new Map<string, unknown>()
    private readonly modifierBindings = new Map<bigint, NativeBindingHandle>()

    constructor(readonly owner: ArrangableInstance, private readonly host: NativeComposition) {
        this.id = host.allocateId()
        arrangeExecutionStats.rearrangeNodesCreated++
        this.stageCreation()
    }

    private stageCreation(): void {
        this.host.stage(native => {
            if (this.retired) return
            native.createNode(this.id, 'LayoutNode')
            arrangeExecutionStats.nativeCreateOperations++
        })
    }

    reconcileChildren(children: readonly RearrangeNode[]): void {
        const next = children as readonly LayoutRearrangeNode[]
        this.host.reconcile(this.id, this.children, next)
        this.host.onCommit(() => { this.children = next })
    }

    updateMeasurePolicy(policy: MeasurePolicy): void {
        this.update('measurePolicy', policy)
    }

    updateModifier(modifier: Modifier): void {
        this.update('modifier', modifier)
    }

    updateInput(name: 'enabled' | 'contentDescription', value: boolean | string | undefined): void {
        this.update(name, value ?? null)
    }

    private update(name: string, value: unknown): void {
        if (this.retired) throw new Error('不能更新已退休的重排节点')
        const current = this.pendingInputs.has(name) ? this.pendingInputs : this.inputs
        if (current.has(name) && Object.is(current.get(name), value)) return
        const staged = this.pendingInputs.has(name)
        this.pendingInputs.set(name, value)
        if (staged) return

        this.host.stage(native => {
            if (this.retired) return
            const value = this.pendingInputs.get(name)
            if (name === 'modifier' && this.writeModifier(native, value as Modifier)) return
            let binding = this.bindings.get(name)
            if (!binding) {
                binding = native.registerBinding(this.id, name)
                this.bindings.set(name, binding)
                this.host.onAbort(() => { this.bindings.delete(name) })
            }
            try { native.updateBinding(binding, value as Parameters<NativeTransactionTarget['updateBinding']>[1]) } catch (error) {
                const source = this.owner.propStore.source(name)
                if (error instanceof Error && source && !error.message.includes('来源：')) error.message += `\n来源：${source}`
                throw error
            }
            if (name === 'modifier') {
                modifierStats.chainWrites++
                const previousBindings = [...this.modifierBindings.values()]
                for (const handle of previousBindings) native.releaseBinding(handle)
                this.host.onCommit(() => this.modifierBindings.clear())
            }
        }, () => {
            this.inputs.set(name, this.pendingInputs.get(name))
            this.pendingInputs.delete(name)
        }, () => { this.pendingInputs.delete(name) })
    }

    private writeModifier(native: NativeTransactionTarget, next: Modifier): boolean {
        const previous = this.inputs.get('modifier') as Modifier | undefined
        if (!previous) return false
        if (previous.elements.length === next.elements.length && previous.elements.every((element, index) => sameModifierElement(element, next.elements[index]))) {
            modifierStats.equalWritesSkipped++
            return true
        }
        if (previous.elements.length !== next.elements.length || previous.elements.some((item, index) => item.type !== next.elements[index].type || item.key !== next.elements[index].key)) return false
        const handles = native.modifierInstances(this.id)
        if (handles.length !== next.elements.length) throw new Error('已提交 Modifier 描述与原生实例不一致')
        for (let index = 0; index < next.elements.length; index++) {
            const element = next.elements[index]
            if (sameModifierElement(previous.elements[index], element)) continue
            const handle = handles[index]
            if (handle.kind !== nativeModifierKind(element) || handle.key !== (element.key ?? '')) throw new Error('Modifier 参数更新目标与已提交实例不一致')
            this.writeModifierInstance(native, handle, element)
        }
        return true
    }

    private writeModifierInstance(native: NativeTransactionTarget, handle: NativeModifierHandle, element: ModifierElement): void {
        let binding = this.modifierBindings.get(handle.identity)
        if (!binding) {
            binding = native.registerModifierBinding(this.id, handle)
            this.modifierBindings.set(handle.identity, binding)
            this.host.onAbort(() => { this.modifierBindings.delete(handle.identity) })
        }
        native.updateBinding(binding, element)
        modifierStats.instanceWrites++
    }

    deactivate(): void {
        this.attached = false
        this.bindings.clear()
        this.modifierBindings.clear()
        this.children = []
    }

    activate(): void {
        if (this.attached || this.retired) return
        const previousId = this.id
        const inputs = new Map(this.inputs)
        this.id = this.host.allocateId()
        this.attached = true
        this.inputs.clear()
        this.stageCreation()
        this.host.onAbort(() => {
            this.id = previousId
            this.attached = false
            this.inputs.clear()
            for (const [name, value] of inputs) this.inputs.set(name, value)
        })
        for (const [name, value] of inputs) this.update(name, value)
    }

    retire(): void {
        if (this.retired) return
        this.retired = true
        arrangeExecutionStats.rearrangeNodesRetired++
        this.bindings.clear()
        this.inputs.clear()
        this.pendingInputs.clear()
        this.modifierBindings.clear()
        this.children = []
    }
}


function nativeModifierKind(element: ModifierElement): string {
    return element.type === 'absoluteOffset' ? 'offset' : element.type
}

function sameDescriptorFields(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
    const a = left as Record<string, unknown>
    const b = right as Record<string, unknown>
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]))
}

// 只比较正式 Modifier 的值字段，业务对象与回调仍按身份判断，不递归探测任意对象
const descriptorFields: Readonly<Record<string, readonly string[]>> = {
    background: ['brush', 'shape'], border: ['brush', 'shape'], clip: ['shape'], graphicsLayer: ['transformOrigin'],
    text: ['textStyle'], textField: ['textStyle'], paint: ['painter', 'colorFilter'],
    verticalScroll: ['state'], horizontalScroll: ['state'], animateContentSize: ['animationSpec'],
}

function sameModifierElement(left: ModifierElement, right: ModifierElement): boolean {
    if (left === right) return true
    if (left.type !== right.type || left.key !== right.key) return false
    const fields = descriptorFields[left.type] ?? []
    const keys = Object.keys(left.value)
    return keys.length === Object.keys(right.value).length && keys.every(key => Object.prototype.hasOwnProperty.call(right.value, key) && (Object.is(left.value[key], right.value[key]) || fields.includes(key) && sameDescriptorFields(left.value[key], right.value[key])))
}
