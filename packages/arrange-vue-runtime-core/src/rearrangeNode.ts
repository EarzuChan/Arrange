import type { ArrangableInstance } from './arrangable.ts'

// 节点只由 Layout 实现创建，这里声明重排与后端应用的职责边界
export interface RearrangeNode {
    readonly owner: ArrangableInstance
    readonly children: readonly RearrangeNode[]
    reconcileChildren(children: readonly RearrangeNode[]): void
    deactivate(): void
    activate(): void
    retire(): void
}

export interface CompositionHost { // TODO：Composition？？？真该改你名了
    begin(): void
    reconcileRoots(roots: readonly RearrangeNode[]): void
    apply(complete: (error?: Error) => void): void
    rollback(): void
}
