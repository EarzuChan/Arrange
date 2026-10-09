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

// 应用原生候选并交付回执；RearrangeSession 负责前端实例和结构账本
export interface RearrangeHost {
    currentTime(): number
    requestFrame(pending: boolean): void
    begin(): void
    reconcileRoots(roots: readonly RearrangeNode[]): void
    apply(complete: (error?: Error) => void): void
    beginContinuation?(): void
    applyContinuation?(): void
    rollback(): void
}
