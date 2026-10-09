// Layout 的受控子组合服务，基础组件只提供内容，节点仍由 Layout 创建
export interface LayoutContentProvider {
    prepare(indices: readonly number[]): void
    render(): void
}
