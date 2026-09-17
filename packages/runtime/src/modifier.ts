import {computed} from "@arrange/vue-reactivity"
import {arrangeValue} from "@arrange/vue-runtime-core"
import {nativeAnimationSpec, spring, type AnimationSpec} from "./animation.ts"
import {PaddingValues} from "./primitives.ts"
import type {Brush, PaddingValue, Shape} from "./primitives.ts"

export type ModifierValue = Readonly<Record<string, unknown>>

export type ModifierElement = Readonly<{
    type: string
    key?: string
    value: ModifierValue
}>

export type ScrollStateLike = {
    value?: number
    maxValue?: number
    viewportSize?: number
    contentSize?: number
    __arrangeNativeScroll?: (payload: never) => void
    [key: string]: unknown
}

export const modifierAllocationStats = {chains: 0, elementReferences: 0}

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

    // 为最后一层提供协调身份；不是 native slot 的运行时 handle。
    keyed(key: string): Modifier {
        if (!key || this.elements.length === 0) throw new TypeError("Modifier.keyed requires a nonempty key and an element")
        const elements = [...this.elements]
        elements[elements.length - 1] = Object.freeze({...elements[elements.length - 1], key})
        return new Modifier(elements)
    }

    if(condition: boolean, ifModifier: Modifier, elseModifier: Modifier = m): Modifier {
        return condition ? this.then(ifModifier) : this.then(elseModifier)
    }

    animateContentSize(animationSpec: AnimationSpec = spring(), args: {clip?: boolean} = {}): Modifier {
        return this.#add("animateContentSize", {animationSpec: nativeAnimationSpec(animationSpec), clip: args.clip ?? true})
    }

    width(value: number): Modifier { return this.#add("width", {value}) }
    height(value: number): Modifier { return this.#add("height", {value}) }
    size(width: number, height = width): Modifier { return this.#add("size", {width, height}) }
    requiredWidth(width: number): Modifier { return this.#add("requiredWidth", {width}) }
    requiredHeight(height: number): Modifier { return this.#add("requiredHeight", {height}) }
    requiredSize(width: number, height = width): Modifier { return this.#add("requiredSize", {width, height}) }
    widthIn(args: Record<string, number | undefined>): Modifier { return this.#add("widthIn", {...args}) }
    heightIn(args: Record<string, number | undefined>): Modifier { return this.#add("heightIn", {...args}) }
    sizeIn(args: Record<string, number | undefined>): Modifier { return this.#add("sizeIn", {...args}) }
    defaultMinSize(args: Record<string, number | undefined>): Modifier { return this.#add("defaultMinSize", {...args}) }
    fillMaxWidth(fraction = 1): Modifier { return this.#add("fillMaxWidth", checkedFraction(fraction)) }
    fillMaxHeight(fraction = 1): Modifier { return this.#add("fillMaxHeight", checkedFraction(fraction)) }
    fillMaxSize(fraction = 1): Modifier { return this.#add("fillMaxSize", checkedFraction(fraction)) }
    padding(value: PaddingValue): Modifier { return this.#add("padding", PaddingValues(value)) }
    offset(args: {x?: number; y?: number}): Modifier { return this.#add("offset", {x: args.x ?? 0, y: args.y ?? 0}) }
    absoluteOffset(args: {x?: number; y?: number}): Modifier { return this.#add("absoluteOffset", {x: args.x ?? 0, y: args.y ?? 0}) }
    align(alignment: string): Modifier { return this.#add("align", {alignment}) }
    weight(weight: number, args: {fill?: boolean} = {}): Modifier {
        if (!(weight > 0)) throw new RangeError("m.weight(...) requires weight > 0")
        return this.#add("weight", {weight, fill: args.fill ?? true})
    }
    zIndex(value: number): Modifier { return this.#add("zIndex", {value}) }
    background(brush: Brush | number, shape?: Shape): Modifier { return this.#add("background", {brush, shape}) }
    border(widthOrArgs: number | Record<string, unknown>, brush?: Brush | number, shape?: Shape): Modifier {
        return typeof widthOrArgs === "object" ? this.#add("border", {align: "inside", ...widthOrArgs}) : this.#add("border", {width: widthOrArgs, brush, shape, align: "inside"})
    }
    clip(shape: Shape): Modifier { return this.#add("clip", {shape}) }
    dropShadow(args: Record<string, unknown>): Modifier { return this.#add("dropShadow", {...args}) }
    innerShadow(args: Record<string, unknown>): Modifier { return this.#add("innerShadow", {...args}) }
    alpha(value: number): Modifier { return this.#add("alpha", {value}) }
    graphicsLayer(args: Record<string, unknown> = {}): Modifier { return this.#add("graphicsLayer", {...args}) }
    clickable(arg: (() => void) | Record<string, unknown>): Modifier {
        return this.#add("clickable", typeof arg === "function" ? {onClick: arg, enabled: true, focusable: true} : {enabled: true, focusable: true, ...arg})
    }
    hoverable(args: Record<string, unknown> = {}): Modifier { return this.#add("hoverable", {enabled: true, ...args}) }
    focusable(arg: boolean | Record<string, unknown> = true): Modifier { return this.#add("focusable", typeof arg === "boolean" ? {enabled: arg} : {enabled: true, ...arg}) }
    // pointerInput 将来会在 native typed pointer event slot、派发、释放与测试齐全后再正规添加回来；当前故意不公开半支持 API。
    verticalScroll(state: ScrollStateLike, args: Record<string, unknown> = {}): Modifier { return this.#add("verticalScroll", {state: scrollStateSnapshot(state), enabled: true, ...args}) }
    horizontalScroll(state: ScrollStateLike, args: Record<string, unknown> = {}): Modifier { return this.#add("horizontalScroll", {state: scrollStateSnapshot(state), enabled: true, ...args}) }


    #add(type: string, value: Record<string, unknown>): Modifier {
        return new Modifier([...this.elements, Object.freeze({type, value: Object.freeze(value)})])
    }
}


function checkedFraction(fraction: number): Readonly<{fraction: number}> {
    if (typeof fraction !== "number" || fraction < 0 || fraction > 1) throw new RangeError("fillMax* fraction must be in 0..1")
    return {fraction}
}

export function toModifier(value: Modifier | null | undefined): Modifier {
    if (value == null) return m
    if (value instanceof Modifier) return value
    throw new TypeError("Expected Arrange Modifier")
}

export const m = new Modifier()

function scrollStateSnapshot(state: ScrollStateLike): ScrollStateLike {
    return {
        value: state.value ?? 0,
        maxValue: state.maxValue ?? 0,
        viewportSize: state.viewportSize ?? 0,
        contentSize: state.contentSize ?? 0,
        __arrangeNativeScroll: state.__arrangeNativeScroll,
    }
}


export const modifierStats = {parameterEvaluations: 0, chainsAssembled: 0, instanceWrites: 0, chainWrites: 0, equalWritesSkipped: 0}

const builtinMethods = new Map(Object.getOwnPropertyNames(Modifier.prototype).map(name => [name, (Modifier.prototype as unknown as Record<string, unknown>)[name]]))

/** Compiler-only lowering of a fixed, proven native factory chain. */
export function arrangeModifier(root: Modifier, segments: readonly (readonly [string, () => unknown[]])[]) {
    const invoke = (receiver: Modifier, method: string, args: unknown[]) => {
        const factory = (receiver as unknown as Record<string, (...args: unknown[]) => Modifier>)[method]
        return factory.apply(receiver, args)
    }
    const valid = () => root === m && segments.every(([name]) => (Modifier.prototype as unknown as Record<string, unknown>)[name] === builtinMethods.get(name))
    const parameters = segments.map(([method, read]) => computed(() => {
        modifierStats.parameterEvaluations++
        return invoke(root, method, read())
    }))
    return arrangeValue(() => {
        if (!valid()) {
            let result = root
            for (const [method, read] of segments) result = invoke(result, method, read())
            return result
        }
        modifierStats.chainsAssembled++
        return new Modifier(parameters.flatMap(parameter => parameter.value.elements))
    })
}
