export { Dp, Sp, Px, ColorValue, dp, sp, px, Color } from './unit.ts'
export type { ColorChannels } from './unit.ts'

/** @arrangeFields shape */
export type Shape = Readonly<{ type: "rectangle" | "circle" }> | Readonly<{ type: "rounded"; radius: number }>
/** @arrangeFields brush */
export type Brush = Readonly<{ type: "solidColor"; color: number }>
/** @arrangeFields padding */
export type PaddingValue = number | { start?: number; top?: number; end?: number; bottom?: number; horizontal?: number; vertical?: number }
/** @arrangeFields padding */
export type Padding = Readonly<{ start: number; top: number; end: number; bottom: number }>

/** @arrangeArguments color */
export function colorToHex(color: number): string {
    return `0x${(color >>> 0).toString(16).toUpperCase().padStart(8, "0")}`
}

export const RectangleShape = Object.freeze({ type: "rectangle" })
export const CircleShape = Object.freeze({ type: "circle" })

/** @arrangeArguments dp */
export function rounded(radius: number): Shape {
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError("圆角半径必须是非负有限数值")
    return Object.freeze({ type: "rounded", radius })
}

/** @arrangeArguments color */
export function solidColor(color: number): Brush {
    return Object.freeze({ type: "solidColor", color })
}

export const Alignment = Object.freeze({
    TopStart: "TopStart", TopCenter: "TopCenter", TopEnd: "TopEnd",
    CenterStart: "CenterStart", Center: "Center", CenterEnd: "CenterEnd",
    BottomStart: "BottomStart", BottomCenter: "BottomCenter", BottomEnd: "BottomEnd",
    Baseline: "Baseline",
    Start: "Start", CenterHorizontally: "CenterHorizontally", End: "End",
    Top: "Top", CenterVertically: "CenterVertically", Bottom: "Bottom",
})

export type BoxAlignment = typeof Alignment['TopStart' | 'TopCenter' | 'TopEnd' | 'CenterStart' | 'Center' | 'CenterEnd' | 'BottomStart' | 'BottomCenter' | 'BottomEnd']
export type HorizontalAlignment = typeof Alignment['Start' | 'Center' | 'CenterHorizontally' | 'End']
export type VerticalAlignment = typeof Alignment['Top' | 'Center' | 'CenterVertically' | 'Bottom']
export type AlignmentValue = typeof Alignment[keyof typeof Alignment]
export type ImageAlignment = Exclude<AlignmentValue, 'Baseline'>
export type AxisAlignment = HorizontalAlignment | VerticalAlignment
export type ArrangementName = 'Start' | 'Top' | 'Center' | 'End' | 'Bottom' | 'SpaceBetween' | 'SpaceAround' | 'SpaceEvenly'
export type TextAlignment = 'left' | 'start' | 'Start' | 'center' | 'Center' | 'right' | 'end' | 'End'

/** @arrangeFields arrangement */
type SpacedArrangement<A extends AxisAlignment> = Readonly<{ kind: 'spacedBy'; space: number; alignment?: A }>

/** @arrangeArguments dp */
function spacedBy<A extends AxisAlignment = never>(space: number, alignment?: A): SpacedArrangement<A> {
    return Object.freeze({ kind: "spacedBy", space, alignment })
}

export const Arrangement = Object.freeze({
    Start: "Start", Top: "Top", Center: "Center", End: "End", Bottom: "Bottom",
    SpaceBetween: "SpaceBetween", SpaceAround: "SpaceAround", SpaceEvenly: "SpaceEvenly", spacedBy,
})

/** @arrangeArguments padding */
export function PaddingValues(value: PaddingValue): Padding {
    if (typeof value === "number") return Object.freeze({ start: value, top: value, end: value, bottom: value })
    const horizontal = value.horizontal ?? 0
    const vertical = value.vertical ?? 0
    return Object.freeze({ start: value.start ?? horizontal, top: value.top ?? vertical, end: value.end ?? horizontal, bottom: value.bottom ?? vertical })
}

export const IntrinsicSize = Object.freeze({ Min: "IntrinsicSize.Min", Max: "IntrinsicSize.Max" })
export const ContentScale = Object.freeze({ Fit: "Fit", Crop: "Crop", FillBounds: "FillBounds", Inside: "Inside", None: "None", FillWidth: "FillWidth", FillHeight: "FillHeight" })
export type ContentScaleValue = typeof ContentScale[keyof typeof ContentScale]
export const Role = Object.freeze({ Button: "Button", Checkbox: "Checkbox", Slider: "Slider", TextField: "TextField", Image: "Image" })
export const Orientation = Object.freeze({ Horizontal: "Horizontal", Vertical: "Vertical" })
export const GridCells = Object.freeze({
    Fixed(count: number) {
        return Object.freeze({ type: "Fixed", count })
    }, Adaptive(minSize: number) {
        return Object.freeze({ type: "Adaptive", minSize })
    }
})

type GridItemSpanFactory = ((count: number) => Readonly<{ type: "GridItemSpan"; count: number }>) & {
    MaxLineSpan: Readonly<{ type: "GridItemSpan.MaxLineSpan" }>
}

export const GridItemSpan: GridItemSpanFactory = Object.assign(
    (count: number) => Object.freeze({ type: "GridItemSpan" as const, count }),
    { MaxLineSpan: Object.freeze({ type: "GridItemSpan.MaxLineSpan" as const }) },
)
