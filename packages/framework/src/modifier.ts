import { computed } from "@arrange/reactivity"
import { nativeAnimationSpec, spring, type AnimationSpec } from "./animation/value.ts"
import { IntrinsicSize, PaddingValues } from "./primitives.ts"
import type { IntrinsicSizeValue } from "./primitives.ts"
import type { AlignmentValue, Brush, PaddingValue, Shape } from "./primitives.ts"
import type { ScrollState } from "./state.ts"
import { painterSnapshot } from './painter.ts'
import type { Painter } from './painter.ts'
import type { ContentScaleValue, ImageAlignment, TextAlignment } from './primitives.ts'
import type { TextStyleProp } from './native.ts'
import { focusRequesterIdentity } from './focus.ts'
import type { FocusRequester, FocusProperties, FocusState } from './focus.ts'
import type { DrawCallback, DrawContentCallback, DrawCacheBuilder } from './draw.ts'
export type { DrawSize, DrawRect, DrawPaint, DrawTransform, DrawCallback, DrawContentCallback, DrawCacheResult, DrawCacheBuilder } from './draw.ts'
export { DrawScope } from './draw.ts'

export type ModifierValue = Readonly<Record<string, unknown>>

export type ModifierElement = Readonly<{ type: string, key?: string, value: ModifierValue }>

export type ScrollStateLike = Pick<ScrollState, "value" | "maxValue" | "viewportSize" | "contentSize" | "__arrangeNativeScroll">
export type SizeRange = { minWidthDp?: number; minWidthPx?: number; maxWidthDp?: number; maxWidthPx?: number; minHeightDp?: number; minHeightPx?: number; maxHeightDp?: number; maxHeightPx?: number }
export type BorderOptions = { widthDp: number; widthPx: number; brush: Brush | number; shape?: Shape }
export type ClickableOptions = { onClick: () => void; enabled?: boolean; focusable?: boolean }
export type EnabledOptions = { enabled?: boolean }
export type PaintOptions = Readonly<{ contentScale?: ContentScaleValue; alignment?: ImageAlignment; alpha?: number; colorFilter?: Readonly<{ tint: number }>; sizeToIntrinsics?: boolean }>
export type TextOptions = Readonly<{ style?: TextStyleProp; singleLine?: boolean; minLines?: number; maxLines?: number; textAlign?: TextAlignment; overflow?: 'clip' | 'ellipsis' | 'visible' }>
export type TextFieldOptions = Readonly<{ textStyle?: TextStyleProp; singleLine?: boolean; minLines?: number; maxLines?: number; placeholder?: string; enabled?: boolean; selectAllOnFocus?: boolean; onValueChange?: (value: string) => void; onSubmit?: (value: string) => void; onChange?: (value: string) => void; onBlur?: (value: string) => void }>
export type GraphicsLayerOptions = {
    translationX?: number
    translationY?: number
    scaleX?: number
    scaleY?: number
    rotationZ?: number
    alpha?: number
    clip?: boolean
    transformOrigin?: "TopStart" | "TopCenter" | "TopEnd" | "CenterStart" | "Center" | "CenterEnd" | "BottomStart" | "BottomCenter" | "BottomEnd" | { x?: number; y?: number }
}

export const modifierAllocationStats = { chains: 0, elementReferences: 0 }

export class Modifier {
    readonly elements: readonly ModifierElement[]

    constructor(elements: readonly ModifierElement[] = []) {
        modifierAllocationStats.chains++
        modifierAllocationStats.elementReferences += elements.length
        this.elements = Object.freeze([...elements])
        Object.freeze(this)
    }

    then(other: Modifier | null | undefined): Modifier {
        return new Modifier([...this.elements, ...toModifier(other).elements])
    }

    // 为最后一层提供协调身份；不是 native slot 的运行时 handle
    keyed(key: string): Modifier {
        if (!key || this.elements.length === 0) throw new TypeError("Modifier.keyed 需要非空 key 和至少一层元素")
        const elements = [...this.elements]
        elements[elements.length - 1] = Object.freeze({ ...elements[elements.length - 1], key })
        return new Modifier(elements)
    }

    if(condition: boolean, ifModifier: Modifier, elseModifier: Modifier = M): Modifier {
        return condition ? this.then(ifModifier) : this.then(elseModifier)
    }

    animateContentSize(animationSpec: AnimationSpec = spring(), args: { clip?: boolean } = {}): Modifier {
        return this.#add("animateContentSize", { animationSpec: nativeAnimationSpec(animationSpec), clip: args.clip ?? true })
    }

    width(value: IntrinsicSizeValue): Modifier
    width(dp: number, px: number): Modifier
    width(dp: number | IntrinsicSizeValue, px?: number): Modifier {
        if (typeof dp === 'string') return this.#intrinsic('intrinsicWidth', dp)
        return this.#add("width", { valueDp: dp, valuePx: px })
    }

    height(value: IntrinsicSizeValue): Modifier
    height(dp: number, px: number): Modifier
    height(dp: number | IntrinsicSizeValue, px?: number): Modifier {
        if (typeof dp === 'string') return this.#intrinsic('intrinsicHeight', dp)
        return this.#add("height", { valueDp: dp, valuePx: px })
    }

    size(widthDp: number, widthPx: number, heightDp = widthDp, heightPx = widthPx): Modifier {
        return this.#add("size", { widthDp, widthPx, heightDp, heightPx })
    }

    requiredWidth(dp: number, px: number): Modifier {
        return this.#add("requiredWidth", { widthDp: dp, widthPx: px })
    }

    requiredHeight(dp: number, px: number): Modifier {
        return this.#add("requiredHeight", { heightDp: dp, heightPx: px })
    }

    requiredSize(widthDp: number, widthPx: number, heightDp = widthDp, heightPx = widthPx): Modifier {
        return this.#add("requiredSize", { widthDp, widthPx, heightDp, heightPx })
    }

    widthIn(args: { minDp?: number; minPx?: number; maxDp?: number; maxPx?: number }): Modifier {
        return this.#add("widthIn", { ...args })
    }

    heightIn(args: { minDp?: number; minPx?: number; maxDp?: number; maxPx?: number }): Modifier {
        return this.#add("heightIn", { ...args })
    }

    sizeIn(args: SizeRange): Modifier {
        return this.#add("sizeIn", { ...args })
    }

    defaultMinSize(args: Pick<SizeRange, "minWidthDp" | "minWidthPx" | "minHeightDp" | "minHeightPx">): Modifier {
        return this.#add("defaultMinSize", { ...args })
    }

    fillMaxWidth(fraction = 1): Modifier {
        return this.#add("fillMaxWidth", checkedFraction(fraction))
    }

    fillMaxHeight(fraction = 1): Modifier {
        return this.#add("fillMaxHeight", checkedFraction(fraction))
    }

    fillMaxSize(fraction = 1): Modifier {
        return this.#add("fillMaxSize", checkedFraction(fraction))
    }

    matchParentSize(): Modifier {
        return this.#add('matchParentSize', {})
    }

    padding(dp: number, px: number): Modifier
    padding(value: PaddingValue): Modifier
    padding(dpOrValue: number | PaddingValue, px?: number): Modifier {
        const value = typeof dpOrValue === "number" ? { startDp: dpOrValue, startPx: px ?? 0, topDp: dpOrValue, topPx: px ?? 0, endDp: dpOrValue, endPx: px ?? 0, bottomDp: dpOrValue, bottomPx: px ?? 0 } : dpOrValue
        return this.#add("padding", PaddingValues(value))
    }

    offset(args: { xDp?: number; xPx?: number; yDp?: number; yPx?: number }): Modifier {
        return this.#add("offset", { xDp: args.xDp ?? 0, xPx: args.xPx ?? 0, yDp: args.yDp ?? 0, yPx: args.yPx ?? 0 })
    }

    absoluteOffset(args: { xDp?: number; xPx?: number; yDp?: number; yPx?: number }): Modifier {
        return this.#add("absoluteOffset", { xDp: args.xDp ?? 0, xPx: args.xPx ?? 0, yDp: args.yDp ?? 0, yPx: args.yPx ?? 0 })
    }

    align(alignment: AlignmentValue): Modifier {
        return this.#add("align", { alignment })
    }

    weight(weight: number, args: { fill?: boolean } = {}): Modifier {
        if (!(weight > 0)) throw new RangeError("M.weight(...) 的权重必须大于零")
        return this.#add("weight", { weight, fill: args.fill ?? true })
    }

    zIndex(value: number): Modifier {
        return this.#add("zIndex", { value })
    }

    background(brush: Brush | number, shape?: Shape): Modifier {
        return this.#add("background", { brush, shape })
    }

    paint(painter: Painter, options: PaintOptions = {}): Modifier {
        return this.#add('paint', { painter: painterSnapshot(painter), ...options })
    }

    text(text: string, options: TextOptions = {}): Modifier {
        return this.#add('text', { text, ...options, style: options.style && Object.freeze({ ...options.style }) })
    }

    textField(value: string, options: TextFieldOptions = {}): Modifier {
        return this.#add('textField', { value, ...options, textStyle: options.textStyle && Object.freeze({ ...options.textStyle }) })
    }

    border(args: BorderOptions): Modifier
    border(widthDp: number, widthPx: number, brush: Brush | number, shape?: Shape): Modifier
    border(widthOrArgs: number | BorderOptions, widthPxOrBrush?: number | Brush, brushOrShape?: Brush | number | Shape, shape?: Shape): Modifier {
        return typeof widthOrArgs === "object" ? this.#add("border", { ...widthOrArgs }) : this.#add("border", { widthDp: widthOrArgs, widthPx: widthPxOrBrush as number, brush: brushOrShape as Brush | number, shape })
    }

    clip(shape: Shape): Modifier {
        return this.#add("clip", { shape })
    }

    alpha(value: number): Modifier {
        return this.#add("alpha", { value })
    }

    graphicsLayer(args: GraphicsLayerOptions = {}): Modifier {
        return this.#add("graphicsLayer", { ...args })
    }

    drawBehind(draw: DrawCallback): Modifier {
        return this.#add('drawBehind', checkedDraw(draw))
    }

    drawWithContent(draw: DrawContentCallback): Modifier {
        return this.#add('drawWithContent', checkedDraw(draw))
    }

    drawWithCache(draw: DrawCacheBuilder): Modifier {
        return this.#add('drawWithCache', checkedDraw(draw))
    }

    clickable(arg: (() => void) | ClickableOptions): Modifier {
        return this.#add("clickable", typeof arg === "function" ? { onClick: arg, enabled: true, focusable: true } : { enabled: true, focusable: true, ...arg })
    }

    hoverable(args: EnabledOptions = {}): Modifier {
        return this.#add("hoverable", { enabled: true, ...args })
    }

    focusable(arg: boolean | EnabledOptions = true): Modifier {
        return this.#add("focusable", typeof arg === "boolean" ? { enabled: arg } : { enabled: true, ...arg })
    }

    focusRequester(requester: FocusRequester): Modifier { return this.#add('focusRequester', { requester: focusRequesterIdentity(requester) }) }
    focusGroup(): Modifier { return this.#add('focusGroup', {}) }
    onFocusChanged(callback: (state: FocusState) => void): Modifier {
        if (typeof callback !== 'function') throw new TypeError('onFocusChanged 需要函数')
        return this.#add('onFocusChanged', { callback })
    }
    focusProperties(properties: FocusProperties): Modifier {
        const value: Record<string, unknown> = { canFocus: properties.canFocus ?? true }
        for (const direction of ['next', 'previous', 'up', 'down', 'left', 'right'] as const) if (properties[direction]) value[direction] = focusRequesterIdentity(properties[direction])
        return this.#add('focusProperties', value)
    }

    // pointerInput 将来会在 native typed pointer event slot、派发、释放与测试齐全后再正规添加回来；当前故意不公开半支持 API
    verticalScroll(state: ScrollStateLike, args: EnabledOptions = {}): Modifier {
        return this.#add("verticalScroll", { state: scrollStateSnapshot(state), enabled: true, ...args })
    }

    horizontalScroll(state: ScrollStateLike, args: EnabledOptions = {}): Modifier {
        return this.#add("horizontalScroll", { state: scrollStateSnapshot(state), enabled: true, ...args })
    }

    #add(type: string, value: Record<string, unknown>): Modifier {
        return new Modifier([...this.elements, Object.freeze({ type, value: Object.freeze(value) })])
    }

    #intrinsic(type: string, value: IntrinsicSizeValue): Modifier {
        if (value !== IntrinsicSize.Min && value !== IntrinsicSize.Max) throw new TypeError('固有尺寸必须是 IntrinsicSize.Min 或 Max')
        return this.#add(type, { maximum: value === IntrinsicSize.Max })
    }
}

function checkedFraction(fraction: number): Readonly<{ fraction: number }> {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new RangeError("fillMax* 的比例必须在 0..1 之间")
    return { fraction }
}

function checkedDraw(draw: unknown): { draw: unknown } {
    if (typeof draw !== 'function') throw new TypeError('绘制 Modifier 需要函数')
    return { draw }
}

export function toModifier(value: Modifier | null | undefined): Modifier {
    if (value == null) return M
    if (value instanceof Modifier) return value
    throw new TypeError("需要 Arrange Modifier 对象")
}

export const M = new Modifier()

function scrollStateSnapshot(state: ScrollStateLike): Pick<ScrollStateLike, 'value' | '__arrangeNativeScroll'> {
    return {
        value: state.value ?? 0,
        __arrangeNativeScroll: state.__arrangeNativeScroll,
    }
}

export const modifierStats = { parameterEvaluations: 0, chainsAssembled: 0, instanceWrites: 0, chainWrites: 0, equalWritesSkipped: 0 }

const builtinMethods = new Map(Object.getOwnPropertyNames(Modifier.prototype).map(name => [name, (Modifier.prototype as unknown as Record<string, unknown>)[name]]))

// 编译器仅拆分已经确认的固定原厂 Modifier 链
export function arrangeModifier(root: Modifier, segments: readonly (readonly [string, () => unknown[]])[], source?: string) {
    const invoke = (receiver: Modifier, method: string, args: unknown[]) => {
        const factory = (receiver as unknown as Record<string, (...args: unknown[]) => Modifier>)[method]
        return factory.apply(receiver, args)
    }
    const valid = () => root === M && segments.every(([name]) => (Modifier.prototype as unknown as Record<string, unknown>)[name] === builtinMethods.get(name))
    const parameters = segments.map(([method, read]) => computed(() => {
        modifierStats.parameterEvaluations++
        return invoke(root, method, read())
    }))
    return () => {
        if (!valid()) {
            let result = root
            for (const [method, read] of segments) result = invoke(result, method, read())
            return result
        }
        modifierStats.chainsAssembled++
        return new Modifier(parameters.flatMap(parameter => parameter.value.elements))
    }
}
