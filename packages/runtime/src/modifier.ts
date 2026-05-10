import {PaddingValues} from "./primitives.ts"
import type {Brush, PaddingValue, Shape} from "./primitives.ts"

export type ModifierValue = Readonly<Record<string, unknown>>

export type ModifierElement = Readonly<{
    type: string
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

export class Modifier {
    readonly elements: readonly ModifierElement[]

    constructor(elements: readonly ModifierElement[] = []) {
        this.elements = Object.freeze([...elements])
        Object.freeze(this)
    }

    then(other: Modifier | null | undefined): Modifier {
        return new Modifier([...this.elements, ...toModifier(other).elements])
    }

    if(condition: boolean, ifModifier: Modifier, elseModifier: Modifier = m): Modifier {
        return condition ? this.then(ifModifier) : this.then(elseModifier)
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
    wrapContentWidth(align: string, unbounded = false): Modifier { return this.#add("wrapContentWidth", {align, unbounded}) }
    wrapContentHeight(align: string, unbounded = false): Modifier { return this.#add("wrapContentHeight", {align, unbounded}) }
    wrapContentSize(align: string, unbounded = false): Modifier { return this.#add("wrapContentSize", {align, unbounded}) }
    aspectRatio(ratio: number, matchHeightConstraintsFirst = false): Modifier { return this.#add("aspectRatio", {ratio, matchHeightConstraintsFirst}) }
    padding(value: PaddingValue): Modifier { return this.#add("padding", PaddingValues(value)) }
    offset(args: {x?: number; y?: number}): Modifier { return this.#add("offset", {x: args.x ?? 0, y: args.y ?? 0}) }
    absoluteOffset(args: {x?: number; y?: number}): Modifier { return this.#add("absoluteOffset", {x: args.x ?? 0, y: args.y ?? 0}) }
    align(alignment: string): Modifier { return this.#add("align", {alignment}) }
    weight(weight: number, args: {fill?: boolean} = {}): Modifier {
        if (!(weight > 0)) throw new RangeError("m.weight(...) requires weight > 0")
        return this.#add("weight", {weight, fill: args.fill ?? true})
    }
    matchParentSize(): Modifier { return this.#add("matchParentSize", {}) }
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
    drawBehind(draw: unknown): Modifier { return this.#add("drawBehind", {draw}) }
    drawWithContent(draw: unknown): Modifier { return this.#add("drawWithContent", {draw}) }
    drawWithCache(build: unknown): Modifier { return this.#add("drawWithCache", {build}) }
    clickable(arg: (() => void) | Record<string, unknown>): Modifier {
        return this.#add("clickable", typeof arg === "function" ? {onClick: arg, enabled: true, focusable: true} : {enabled: true, focusable: true, ...arg})
    }
    hoverable(args: Record<string, unknown> = {}): Modifier { return this.#add("hoverable", {enabled: true, ...args}) }
    focusable(arg: boolean | Record<string, unknown> = true): Modifier { return this.#add("focusable", typeof arg === "boolean" ? {enabled: arg} : {enabled: true, ...arg}) }
    focusRequester(requester: unknown): Modifier { return this.#add("focusRequester", {requester}) }
    onFocusChanged(callback: unknown): Modifier { return this.#add("onFocusChanged", {callback}) }
    focusProperties(args: Record<string, unknown>): Modifier { return this.#add("focusProperties", {...args}) }
    focusGroup(): Modifier { return this.#add("focusGroup", {}) }
    pointerInput(handler: unknown): Modifier { return this.#add("pointerInput", {handler}) }
    verticalScroll(state: ScrollStateLike, args: Record<string, unknown> = {}): Modifier { return this.#add("verticalScroll", {state: scrollStateSnapshot(state), enabled: true, ...args}) }
    horizontalScroll(state: ScrollStateLike, args: Record<string, unknown> = {}): Modifier { return this.#add("horizontalScroll", {state: scrollStateSnapshot(state), enabled: true, ...args}) }
    scrollable(state: ScrollStateLike, orientation: string, args: Record<string, unknown> = {}): Modifier { return this.#add("scrollable", {state, orientation, enabled: true, ...args}) }
    animateContentSize(): Modifier { return this.#add("animateContentSize", {}) }
    testTag(name: string): Modifier { return this.#add("testTag", {name}) }

    toJSON(): Array<Record<string, unknown>> {
        return this.elements.map((element) => ({type: element.type, ...serializable(element.value) as Record<string, unknown>}))
    }

    #add(type: string, value: Record<string, unknown>): Modifier {
        return new Modifier([...this.elements, Object.freeze({type, value: Object.freeze(value)})])
    }
}

function serializable(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value, (_key, val: unknown) => typeof val === "function" ? "[Function]" : val))
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
