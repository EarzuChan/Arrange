export type Dp = number & { readonly __brand: "Dp" };
export type Sp = number & { readonly __brand: "Sp" };
export type Px = number & { readonly __brand: "Px" };
export type ArrangeColor = number & { readonly __brand: "ArrangeColor" };
export type Shape = Readonly<Record<string, unknown>>;
export type Brush = Readonly<Record<string, unknown>>;
export class Modifier { readonly elements: readonly unknown[]; then(other: Modifier): Modifier; if(condition: boolean, ifModifier: Modifier, elseModifier?: Modifier): Modifier; [key: string]: unknown }
export const m: Modifier;
export function dp(value: number): Dp; export function sp(value: number): Sp; export function px(value: number): Px;
export function Color(value: number | { red: number; green: number; blue: number; alpha?: number }): ArrangeColor;
export function rounded(value: Dp | Record<string, Dp | undefined>): Shape;
export const Alignment: Record<string, string>; export const Arrangement: Record<string, unknown> & { spacedBy(space: Dp, alignment?: string): unknown };
export const IntrinsicSize: { Min: string; Max: string }; export const ContentScale: Record<string, string>; export const Role: Record<string, string>; export const Orientation: Record<string, string>;
export const GridCells: { Fixed(count: number): unknown; Adaptive(minSize: Dp): unknown }; export function GridItemSpan(count: number): unknown; export namespace GridItemSpan { const MaxLineSpan: unknown }
export const Box: "Box"; export const Row: "Row"; export const Column: "Column"; export const Spacer: "Spacer"; export const Text: "Text"; export const Input: "Input"; export const Image: "Image"; export const Icon: "Icon"; export const Canvas: "Canvas"; export const FlowRow: "FlowRow"; export const FlowColumn: "FlowColumn"; export const LazyColumn: "LazyColumn"; export const LazyRow: "LazyRow"; export const LazyVerticalGrid: "LazyVerticalGrid"; export const LazyHorizontalGrid: "LazyHorizontalGrid";
export function createApp(root: unknown): { mount(target?: unknown): unknown };
export interface ScrollState { value: Dp; maxValue: Dp; viewportSize: Dp; contentSize: Dp; isScrollInProgress: boolean; canScrollBackward: boolean; canScrollForward: boolean; scrollTo(value: Dp): void; animateScrollTo(value: Dp): void; __arrangeNativeScroll(payload: string | Partial<ScrollState>): void }
export function rememberInteractionState(): { hovered: boolean; pressed: boolean; focused: boolean; enabled: boolean }; export function rememberFocusRequester(): { requestFocus(): boolean; requested: boolean }; export function useFocusManager(): { clearFocus(): boolean }; export function rememberScrollState(args?: { initial?: Dp }): ScrollState; export function rememberLazyListState(args?: unknown): unknown; export function rememberLazyGridState(args?: unknown): unknown; export function rememberInputState(args?: unknown): unknown; export function rememberCanvasController(): { invalidate(): void; invalidated: boolean }; export function useParameter(id: string): unknown; export function useHost(): unknown; export function useTransport(): unknown;
export interface AnimationClock { now(): number; requestFrame(callback: (time: number) => void): unknown; cancelFrame(handle: unknown): void }
export interface AnimationState<T> { value: T; stop(): void }
export interface AnimationSpec { durationMillis?: number; easing?: (fraction: number) => number; clock?: AnimationClock }
export const linearEasing: (fraction: number) => number; export const defaultAnimationClock: AnimationClock; export function createManualAnimationClock(): AnimationClock & { advanceBy(deltaMillis: number): void };
export function animateFloatAsState(targetValue: number | { value: number } | (() => number), args?: AnimationSpec): AnimationState<number>;
export function animateDpAsState(targetValue: Dp | { value: Dp } | (() => Dp), args?: AnimationSpec): AnimationState<Dp>;
export function animateColorAsState(targetValue: ArrangeColor | { value: ArrangeColor } | (() => ArrangeColor), args?: AnimationSpec): AnimationState<ArrangeColor>;
export function updateTransition<T>(targetState: T | { value: T } | (() => T), args?: AnimationSpec): { targetState: unknown; animateFloat(label: string, targetForState: (state: T) => number, args?: AnimationSpec): AnimationState<number>; animateDp(label: string, targetForState: (state: T) => Dp, args?: AnimationSpec): AnimationState<Dp>; animateColor(label: string, targetForState: (state: T) => ArrangeColor, args?: AnimationSpec): AnimationState<ArrangeColor> };
export const BRIDGE_MAGIC: number; export const BRIDGE_VERSION: number; export const BridgeOpcode: Record<string, number>; export function encodeBridgeBatch(ops: unknown[]): Uint8Array; export function decodeBridgeBatch(bytes: Uint8Array): unknown;
export const ARRANGE_HMR_RELOAD_EVENT: "arrange:reload";
export function installArrangeHmrClient(hot: { on(event: string, callback: (payload?: unknown) => void): void } | undefined | null, target?: unknown): boolean;

