import type { PxModifier } from './resolveUnits.ts'
import type { ArrangableInstance } from './runtime/internal.ts'
import type { RearrangeHost, RearrangeNode } from './runtime/internal.ts'
import type { NativeBindingHandle, NativeModifierHandle, NativeMutation, NativeTransactionTarget } from './native.ts'
import { Modifier, modifierStats, type ModifierElement } from './modifier.ts'
import type { MeasurePolicy } from './measurePolicy.ts'
import { arrangeExecutionStats } from './runtime/internal.ts'
import type { LayoutContentProvider } from './layoutContent.ts'

export class NativeRearrangeHost implements RearrangeHost {
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
    private sentOperations = 0
    private pendingRoots: readonly LayoutRearrangeNode[] | undefined
    private readonly providers = new Map<number, { node: LayoutRearrangeNode; provider: LayoutContentProvider }>()
    preparationEpoch = 0
    continuing = false

    constructor(readonly native: NativeTransactionTarget) {
        native.installLayoutDriver?.((id, indices) => {
            const entry = this.providers.get(id)
            if (!entry || entry.node.owner.isUnmounted) throw new Error('子组合目标已退休')
            const session = entry.node.owner.rearrangeSession
            session.continuePreparation(() => {
                entry.provider.prepare(indices)
                session.enqueue(entry.node.owner.structure, true)
            })
        })
    }

    registerProvider(node: LayoutRearrangeNode, provider: LayoutContentProvider): void {
        if (!this.native.installLayoutDriver || !this.native.continueRearrange) throw new Error('原生宿主缺少受控子组合驱动')
        const id = node.id
        this.providers.set(id, { node, provider })
        this.onAbort(() => this.providers.delete(id))
    }

    unregisterProvider(id: number): void { this.providers.delete(id) }

    currentTime(): number { return this.native.currentTime() }
    requestFrame(pending: boolean): void { this.native.requestFrame(pending) }

    allocateId(): number { return this.nextId++ }

    begin(): void {
        if (this.preparing || this.applying) throw new Error('原生候选提交不能重入')
        this.preparing = true
        this.preparationEpoch++
        this.continuing = false

        if (!this.rootCreated) {
            this.operations.push(native => {
                native.createNode(1, 'Root')
                arrangeExecutionStats.nativeCreateOperations++
            })
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
        this.reconcile(1, this.pendingRoots ?? this.roots, roots)
        if (!this.pendingRoots) {
            this.commits.push(() => {
                this.roots = this.pendingRoots!
                this.pendingRoots = undefined
            })
            this.aborts.push(() => { this.pendingRoots = undefined })
        }
        this.pendingRoots = roots
    }

    reconcile(parent: number, previous: readonly LayoutRearrangeNode[], next: readonly LayoutRearrangeNode[]): void {
        const retained = new Set(next)
        for (const node of previous) {
            if (retained.has(node)) continue
            const id = node.id
            node.detachCandidate()
            this.stage(native => {
                native.removeChild(parent, id)
                native.deleteNode(id)
                arrangeExecutionStats.nativeRemoveOperations++
            })
        }
        const order = previous.filter(node => retained.has(node))
        for (let index = 0; index < next.length; index++) {
            const node = next[index]
            node.ensureAttached()
            if (order[index] === node) continue
            const old = order.indexOf(node)
            if (old >= 0) order.splice(old, 1)
            order.splice(index, 0, node)
            const id = node.id
            this.stage(native => {
                if (node.id !== id) return
                native.insertChild(parent, id, index)
                arrangeExecutionStats.nativeInsertOperations++
            })
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
            this.flushOperations()
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
                this.sentOperations = 0
                this.continuing = false
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

    beginContinuation(): void {
        if (!this.applying || !this.nativeOpen || this.preparing) throw new Error('子组合没有待提交的原生候选')
        this.preparing = true
        this.continuing = true
        this.preparationEpoch++
    }

    applyContinuation(): void {
        if (!this.preparing || !this.continuing) throw new Error('子组合候选尚未准备')
        this.native.continueRearrange!()
        this.flushOperations()
        this.preparing = false
    }

    private flushOperations(): void {
        while (this.sentOperations < this.operations.length) this.operations[this.sentOperations++](this.native)
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
            this.sentOperations = 0
            this.continuing = false
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
    private nativeDetached = false
    private readonly bindings = new Map<string, NativeBindingHandle>()
    private readonly inputs = new Map<string, unknown>()
    private readonly pendingInputs = new Map<string, unknown>()
    private readonly sentInputs = new Map<string, unknown>()
    private readonly stagedEpochs = new Map<string, number>()
    private pendingChildren: readonly LayoutRearrangeNode[] | undefined
    private provider: LayoutContentProvider | undefined
    private readonly modifierBindings = new Map<bigint, NativeBindingHandle>()

    constructor(readonly owner: ArrangableInstance, private readonly host: NativeRearrangeHost) {
        this.id = host.allocateId()
        arrangeExecutionStats.rearrangeNodesCreated++
        this.stageCreation()
    }

    private stageCreation(): void {
        const id = this.id
        this.host.stage(native => {
            if (this.retired || this.id !== id) return
            native.createNode(id, 'LayoutNode')
            arrangeExecutionStats.nativeCreateOperations++
        })
    }

    reconcileChildren(children: readonly RearrangeNode[]): void {
        const next = children as readonly LayoutRearrangeNode[]
        this.host.reconcile(this.id, this.pendingChildren ?? this.children, next)
        if (!this.pendingChildren) {
            this.host.onCommit(() => {
                this.children = this.pendingChildren!
                this.pendingChildren = undefined
            })
            this.host.onAbort(() => { this.pendingChildren = undefined })
        }
        this.pendingChildren = next
    }

    setContentProvider(provider: LayoutContentProvider): void {
        this.provider = provider
        this.host.registerProvider(this, provider)
    }

    updateMeasurePolicy(policy: MeasurePolicy): void {
        this.update('measurePolicy', policy)
    }

    updateModifier(modifier: PxModifier): void {
        this.update('modifier', modifier)
    }

    updateInput(name: 'enabled' | 'contentDescription', value: boolean | string | undefined): void {
        this.update(name, value ?? null)
    }

    private update(name: string, value: unknown, force = false): void {
        if (this.retired) throw new Error('不能更新已退休的重排节点')
        const current = this.pendingInputs.has(name) ? this.pendingInputs : this.inputs
        if (!force && current.has(name) && Object.is(current.get(name), value)) return
        const staged = this.pendingInputs.has(name)
        this.pendingInputs.set(name, value)
        if (this.stagedEpochs.get(name) === this.host.preparationEpoch) return
        this.stagedEpochs.set(name, this.host.preparationEpoch)
        if (!staged) {
            this.host.onCommit(() => {
                this.inputs.set(name, this.pendingInputs.get(name))
                this.pendingInputs.delete(name)
                this.stagedEpochs.delete(name)
                this.sentInputs.delete(name)
            })
            this.host.onAbort(() => {
                this.pendingInputs.delete(name)
                this.stagedEpochs.delete(name)
                this.sentInputs.delete(name)
            })
        }

        const id = this.id
        this.host.stage(native => {
            if (this.retired || this.id !== id) return
            const value = this.pendingInputs.get(name)
            if (name === 'modifier' && this.bindings.has(name) && !this.host.continuing && this.writeModifier(native, value as PxModifier)) return
            let binding = this.bindings.get(name)
            const freshBinding = !binding
            if (!binding) {
                binding = native.registerBinding(this.id, name)
                this.bindings.set(name, binding)
                this.host.onAbort(() => { this.bindings.delete(name) })
            }
            let input = value
            if (name === 'measurePolicy') {
                const current = value as MeasurePolicy
                const previous = freshBinding ? undefined : (this.sentInputs.get(name) ?? this.inputs.get(name)) as MeasurePolicy | undefined
                if (current.kind === 'Lazy' && previous?.kind === 'Lazy' && current.version === previous.version) {
                    const { keys, contentTypes, spans, ...reference } = current
                    input = reference
                }
                this.sentInputs.set(name, value)
            }
            try { native.updateBinding(binding, input as Parameters<NativeTransactionTarget['updateBinding']>[1]) } catch (error) {
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
        })
    }

    detachCandidate(): void {
        if (this.nativeDetached) return
        this.nativeDetached = true
        this.host.onAbort(() => { this.nativeDetached = false })
        const id = this.id
        this.host.onCommit(() => { if (this.nativeDetached || this.id !== id) this.host.unregisterProvider(id) })
        for (const child of this.pendingChildren ?? this.children) child.detachCandidate()
    }

    ensureAttached(): void {
        if (!this.nativeDetached || this.retired) return
        const previousId = this.id
        const bindings = new Map(this.bindings)
        const modifierBindings = new Map(this.modifierBindings)
        const sentInputs = new Map(this.sentInputs)
        const stagedEpochs = new Map(this.stagedEpochs)
        const values = new Map([...this.inputs, ...this.pendingInputs])
        this.nativeDetached = false
        this.id = this.host.allocateId()
        this.bindings.clear()
        this.modifierBindings.clear()
        this.sentInputs.clear()
        this.stagedEpochs.clear()
        this.stageCreation()
        if (this.provider) this.host.registerProvider(this, this.provider)
        this.host.onAbort(() => {
            this.id = previousId
            this.nativeDetached = true
            this.bindings.clear()
            this.modifierBindings.clear()
            this.sentInputs.clear()
            this.stagedEpochs.clear()
            for (const [key, value] of bindings) this.bindings.set(key, value)
            for (const [key, value] of modifierBindings) this.modifierBindings.set(key, value)
            for (const [key, value] of sentInputs) this.sentInputs.set(key, value)
            for (const [key, value] of stagedEpochs) this.stagedEpochs.set(key, value)
        })
        for (const [name, value] of values) this.update(name, value, true)
        for (const [index, child] of (this.pendingChildren ?? this.children).entries()) {
            child.ensureAttached()
            const id = child.id
            const parent = this.id
            this.host.stage(native => {
                native.insertChild(parent, id, index)
                arrangeExecutionStats.nativeInsertOperations++
            })
        }
    }

    private writeModifier(native: NativeTransactionTarget, next: PxModifier): boolean {
        const previous = this.inputs.get('modifier') as PxModifier | undefined
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
        this.host.unregisterProvider(this.id)
        this.attached = false
        this.nativeDetached = true
        this.bindings.clear()
        this.modifierBindings.clear()
        this.children = []
    }

    activate(): void {
        if (this.attached || this.retired) return
        this.attached = true
        this.host.onAbort(() => { this.attached = false })
        this.ensureAttached()
    }

    retire(): void {
        if (this.retired) return
        this.retired = true
        this.host.unregisterProvider(this.id)
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
    text: ['style'], textField: ['textStyle'], paint: ['painter', 'colorFilter'],
    verticalScroll: ['state'], horizontalScroll: ['state'], animateContentSize: ['animationSpec'],
}

function sameModifierElement(left: ModifierElement, right: ModifierElement): boolean {
    if (left === right) return true
    if (left.type !== right.type || left.key !== right.key) return false
    const fields = descriptorFields[left.type] ?? []
    const keys = Object.keys(left.value)
    return keys.length === Object.keys(right.value).length && keys.every(key => Object.prototype.hasOwnProperty.call(right.value, key) && (Object.is(left.value[key], right.value[key]) || fields.includes(key) && sameDescriptorFields(left.value[key], right.value[key])))
}
