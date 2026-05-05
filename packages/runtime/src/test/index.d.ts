export interface Rect { x: number; y: number; width: number; height: number }
export interface ArrangeNodeSubject { bounds(): Rect; baseline(): number | undefined; text(): string | undefined; performClick(): boolean; requestFocus(): boolean; isFocused(): boolean; performHoverEnter(): boolean; performHoverExit(): boolean }
export interface ArrangeTestRule { node(tag: string): ArrangeNodeSubject; snapshot(): unknown; drawOps(): unknown[]; clearFocus(): boolean; performKey(key: "Enter" | "Space" | " " | string): boolean; waitForIdle(): Promise<void> }
export function h(type: string, props?: Record<string, unknown>, children?: unknown[] | unknown): unknown
export function renderToBridgeOps(root: unknown): unknown[]
export function renderToBridgeBatch(root: unknown): { ops: unknown[]; callbacks: unknown[] }
export class BridgeOpWriter { readonly ops: unknown[]; mount(vnode: unknown): unknown }
export function renderArrange(root: unknown, options?: { width?: number; height?: number; constraints?: unknown }): Promise<ArrangeTestRule>
