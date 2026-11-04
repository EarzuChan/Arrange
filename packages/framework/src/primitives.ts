import { requireArgb } from './color.ts'

export { Dp, Sp, Px } from './unit.ts'

export type CornerSizes = Readonly<{ topStartDp?: number; topStartPx?: number; topEndDp?: number; topEndPx?: number; bottomEndDp?: number; bottomEndPx?: number; bottomStartDp?: number; bottomStartPx?: number }>
export type Shape = Readonly<{ type: "rectangle" | "circle" }> | Readonly<{ type: "rounded"; topStartDp: number; topStartPx: number; topEndDp: number; topEndPx: number; bottomEndDp: number; bottomEndPx: number; bottomStartDp: number; bottomStartPx: number }>
// 渐变几何取所绘形状外包盒的 0 到 1 比例
export type BrushPoint = Readonly<{ x: number; y: number }>
export type ColorStop = readonly [position: number, color: number]
type GradientColors = Readonly<{ colors: readonly number[]; stops: readonly number[] }>
export type LinearGradient = GradientColors & Readonly<{ type: "linearGradient"; start: BrushPoint; end: BrushPoint }>
// 半径 1 表示到达离中心最远的角
export type RadialGradient = GradientColors & Readonly<{ type: "radialGradient"; center: BrushPoint; radius: number }>
// 起始角为度数，0 指向右侧、顺时针
export type SweepGradient = GradientColors & Readonly<{ type: "sweepGradient"; center: BrushPoint; startAngle: number }>
export type SolidColor = Readonly<{ type: "solidColor"; color: number }>
export type Brush = SolidColor | LinearGradient | RadialGradient | SweepGradient
export type PaddingValue = Readonly<{ startDp?: number; startPx?: number; topDp?: number; topPx?: number; endDp?: number; endPx?: number; bottomDp?: number; bottomPx?: number; horizontalDp?: number; horizontalPx?: number; verticalDp?: number; verticalPx?: number }>
export type Padding = Readonly<{ startDp: number; startPx: number; topDp: number; topPx: number; endDp: number; endPx: number; bottomDp: number; bottomPx: number }>

export function colorToHex(color: number): string {
    return `0x${requireArgb(color).toString(16).toUpperCase().padStart(8, "0")}`
}

export const RectangleShape = Object.freeze({ type: "rectangle" })
export const CircleShape = Object.freeze({ type: "circle" })

export function rounded(radiusDp: number, radiusPx: number): Shape {
    return roundedCorners({ topStartDp: radiusDp, topStartPx: radiusPx, topEndDp: radiusDp, topEndPx: radiusPx, bottomEndDp: radiusDp, bottomEndPx: radiusPx, bottomStartDp: radiusDp, bottomStartPx: radiusPx })
}

// 分角圆角，未给出的角为 0；当前只有从左到右布局，start 即左侧
export function roundedCorners(value: CornerSizes): Shape {
    const corner = (dp: number | undefined, px: number | undefined): readonly [number, number] => {
        const result = [dp ?? 0, px ?? 0] as const
        if (!result.every(Number.isFinite) || result[0] < 0 || result[1] < 0) throw new RangeError("圆角半径必须是非负有限数值")
        return result
    }
    const [topStartDp, topStartPx] = corner(value.topStartDp, value.topStartPx)
    const [topEndDp, topEndPx] = corner(value.topEndDp, value.topEndPx)
    const [bottomEndDp, bottomEndPx] = corner(value.bottomEndDp, value.bottomEndPx)
    const [bottomStartDp, bottomStartPx] = corner(value.bottomStartDp, value.bottomStartPx)
    return Object.freeze({ type: "rounded", topStartDp, topStartPx, topEndDp, topEndPx, bottomEndDp, bottomEndPx, bottomStartDp, bottomStartPx })
}

export function solidColor(color: number): SolidColor {
    return Object.freeze({ type: "solidColor", color: requireArgb(color) })
}

// 颜色均匀分布，或以 [位置, 颜色] 给出不递减的 0 到 1 位置
function gradientColors(input: readonly (number | ColorStop)[]): GradientColors {
    if (!Array.isArray(input) || input.length < 2 || input.length > 64) throw new RangeError("渐变需要 2 到 64 个颜色")
    const pairs = input.every(value => typeof value !== "number")
    if (pairs ? !input.every(value => Array.isArray(value) && value.length === 2) : !input.every(value => typeof value === "number")) throw new TypeError("渐变颜色需要全为颜色或全为 [位置, 颜色]")
    const colors = input.map(value => requireArgb(typeof value === "number" ? value : value[1]))
    const stops = input.map((value, index) => typeof value === "number" ? index / (input.length - 1) : value[0])
    stops.forEach((stop, index) => {
        if (!Number.isFinite(stop) || stop < 0 || stop > 1 || index > 0 && stop < stops[index - 1]) throw new RangeError("渐变色标位置需要在 0 到 1 之间且不递减")
    })
    return { colors: Object.freeze(colors), stops: Object.freeze(stops) }
}

function brushPoint(value: BrushPoint, name: string): BrushPoint {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError(`${name} 需要有限数值`)
    return Object.freeze({ x: value.x, y: value.y })
}

export function linearGradient(colors: readonly (number | ColorStop)[], options: Readonly<{ start?: BrushPoint; end?: BrushPoint }> = {}): Brush {
    return Object.freeze({ type: "linearGradient", ...gradientColors(colors), start: brushPoint(options.start ?? { x: 0, y: 0 }, "start"), end: brushPoint(options.end ?? { x: 1, y: 1 }, "end") })
}

export function verticalGradient(colors: readonly (number | ColorStop)[]): Brush {
    return linearGradient(colors, { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } })
}

export function horizontalGradient(colors: readonly (number | ColorStop)[]): Brush {
    return linearGradient(colors, { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })
}

export function radialGradient(colors: readonly (number | ColorStop)[], options: Readonly<{ center?: BrushPoint; radius?: number }> = {}): Brush {
    const radius = options.radius ?? 1
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError("径向渐变半径必须是非负有限数值")
    return Object.freeze({ type: "radialGradient", ...gradientColors(colors), center: brushPoint(options.center ?? { x: 0.5, y: 0.5 }, "center"), radius })
}

export function sweepGradient(colors: readonly (number | ColorStop)[], options: Readonly<{ center?: BrushPoint; startAngle?: number }> = {}): Brush {
    const startAngle = options.startAngle ?? 0
    if (!Number.isFinite(startAngle)) throw new TypeError("扫描渐变起始角需要有限数值")
    return Object.freeze({ type: "sweepGradient", ...gradientColors(colors), center: brushPoint(options.center ?? { x: 0.5, y: 0.5 }, "center"), startAngle })
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

type SpacedArrangement<A extends AxisAlignment> = Readonly<{ kind: 'spacedBy'; spaceDp: number; spacePx: number; alignment?: A }>

function spacedBy<A extends AxisAlignment = never>(spaceDp: number, spacePx: number, alignment?: A): SpacedArrangement<A> {
    return Object.freeze({ kind: "spacedBy", spaceDp, spacePx, alignment })
}

export const Arrangement = Object.freeze({
    Start: "Start", Top: "Top", Center: "Center", End: "End", Bottom: "Bottom",
    SpaceBetween: "SpaceBetween", SpaceAround: "SpaceAround", SpaceEvenly: "SpaceEvenly", spacedBy,
})

export function PaddingValues(value: PaddingValue): Padding {
    const horizontalDp = value.horizontalDp ?? 0
    const horizontalPx = value.horizontalPx ?? 0
    const verticalDp = value.verticalDp ?? 0
    const verticalPx = value.verticalPx ?? 0
    return Object.freeze({
        startDp: value.startDp ?? horizontalDp,
        startPx: value.startPx ?? horizontalPx,
        topDp: value.topDp ?? verticalDp,
        topPx: value.topPx ?? verticalPx,
        endDp: value.endDp ?? horizontalDp,
        endPx: value.endPx ?? horizontalPx,
        bottomDp: value.bottomDp ?? verticalDp,
        bottomPx: value.bottomPx ?? verticalPx,
    })
}

export const IntrinsicSize = Object.freeze({ Min: "IntrinsicSize.Min", Max: "IntrinsicSize.Max" })
export type IntrinsicSizeValue = typeof IntrinsicSize[keyof typeof IntrinsicSize]
export const ContentScale = Object.freeze({ Fit: "Fit", Crop: "Crop", FillBounds: "FillBounds", Inside: "Inside", None: "None", FillWidth: "FillWidth", FillHeight: "FillHeight" })
export type ContentScaleValue = typeof ContentScale[keyof typeof ContentScale]
export const Role = Object.freeze({ Button: "Button", Checkbox: "Checkbox", Slider: "Slider", TextField: "TextField", Image: "Image" })
export const Orientation = Object.freeze({ Horizontal: "Horizontal", Vertical: "Vertical" })
export type GridCellsValue = Readonly<{ type: 'Fixed'; count: number }> | Readonly<{ type: 'Adaptive'; minSizeDp: number; minSizePx: number }>
export const GridCells = Object.freeze({
    Fixed(count: number): Extract<GridCellsValue, { type: 'Fixed' }> {
        if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw new RangeError('网格数量必须是 1..4096 的整数')
        return Object.freeze({ type: 'Fixed', count })
    },
    Adaptive(minSizeDp: number, minSizePx: number): Extract<GridCellsValue, { type: 'Adaptive' }> {
        if (!Number.isFinite(minSizeDp) || !Number.isFinite(minSizePx) || minSizeDp < 0 || minSizePx < 0 || minSizeDp + minSizePx <= 0) throw new RangeError('网格最小尺寸必须是非负且总和大于零的 DP/PX 长度')
        return Object.freeze({ type: 'Adaptive', minSizeDp, minSizePx })
    },
})

export type GridItemSpanValue = Readonly<{ type: 'GridItemSpan'; count: number }> | Readonly<{ type: 'GridItemSpan.MaxLineSpan' }>

type GridItemSpanFactory = ((count: number) => Readonly<{ type: "GridItemSpan"; count: number }>) & {
    MaxLineSpan: Readonly<{ type: "GridItemSpan.MaxLineSpan" }>
}

export const GridItemSpan: GridItemSpanFactory = Object.assign(
    (count: number) => {
        if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw new RangeError('网格跨度必须是 1..4096 的整数')
        return Object.freeze({ type: 'GridItemSpan' as const, count })
    },
    { MaxLineSpan: Object.freeze({ type: "GridItemSpan.MaxLineSpan" as const }) },
)
