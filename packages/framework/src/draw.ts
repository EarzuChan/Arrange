import { getCurrentScope, pauseTracking, ReactiveEffect, resetTracking, shallowRef, type EffectScope } from '@arrange/reactivity'
import { collectSourceReads, noteSourceRead, sourceStateOf, type DataSource, type DataSourceState } from './dataSource.ts'
import { findFrameScheduler } from './runtime/animationOwner.ts'
import type { FrameParticipant, FrameScheduler } from './runtime/scheduler.ts'
import { requireArgb } from './color.ts'
import { painterSnapshot, type Painter } from './painter.ts'
import type { Brush, ContentScaleValue, ImageAlignment, TextAlignment } from './primitives.ts'
import type { ArrangableInstance } from './runtime/internal.ts'

export type DrawSize = Readonly<{ width: number; height: number }>
export type DrawRect = Readonly<{ x?: number; y?: number; width?: number; height?: number }>
// color 与 brush 二选一；strokeWidth 为 0 表示填充
export type DrawPaint = Readonly<{ color?: number; brush?: Brush; strokeWidth?: number }>
export type StrokeCap = 'butt' | 'round' | 'square'
export type StrokeJoin = 'miter' | 'round' | 'bevel'
export type DrawPathPaint = DrawPaint & Readonly<{ cap?: StrokeCap; join?: StrokeJoin }>
export type DrawTextOptions = Readonly<{ text: string; x?: number; y?: number; width?: number; color: number; fontSize?: number; lineHeight?: number; maxLines?: number; textAlign?: TextAlignment; overflow?: 'clip' | 'ellipsis' | 'visible' }>
// 九宫格切分以图片固有尺寸为单位：四角保持源尺寸，边与中心拉伸
export type NinePatch = Readonly<{ left: number; top: number; right: number; bottom: number }>
export type DrawPainterOptions = DrawRect & Readonly<{ alpha?: number; tint?: number; contentScale?: ContentScaleValue; alignment?: ImageAlignment; tile?: boolean; ninePatch?: NinePatch }>
export type DrawTransform = Readonly<{ translationX?: number; translationY?: number; scaleX?: number; scaleY?: number; rotationZ?: number; originX?: number; originY?: number }>
// 绘制命令编码：操作码与数值参数依次写入 Float64Array，非数值参数进引用表；与原生解码一一对应
// 画笔槽非负为颜色，负数 -(i+1) 指向引用表中的 Brush
export const DrawOpcode = Object.freeze({ Rect: 1, RoundRect: 2, Oval: 3, Line: 4, Clip: 5, PopClip: 6, Transform: 7, PopTransform: 8, Content: 9, Path: 10, Text: 11, Painter: 12, ClipPath: 13, Native: 14 })
// 原生 painter 参数：数值、颜色（数值）、布尔或数据源名
// 数据源参数按名称传给原生 painter，并登记读取：数据推进即重录并重绘
export type NativePainterParams = Readonly<Record<string, number | boolean | string | DataSource>>
export type DrawNativeOptions = DrawRect & Readonly<{ params?: NativePainterParams }>
export const DrawClipShape = Object.freeze({ Rectangle: 0, Rounded: 1, Oval: 2 })
export const PathVerb = Object.freeze({ MoveTo: 0, LineTo: 1, QuadTo: 2, CubicTo: 3, ArcTo: 4, Close: 5 })
const strokeCaps: Readonly<Record<StrokeCap, number>> = { butt: 0, round: 1, square: 2 }
const strokeJoins: Readonly<Record<StrokeJoin, number>> = { miter: 0, round: 1, bevel: 2 }
const textAligns: Readonly<Record<TextAlignment, number>> = { left: 0, start: 0, Start: 0, center: 1, Center: 1, right: 2, end: 2, End: 2 }
const textOverflows = { clip: 0, ellipsis: 1, visible: 2 } as const
const contentScales: Readonly<Record<ContentScaleValue, number>> = { Fit: 0, Crop: 1, FillBounds: 2, Inside: 3, None: 4, FillWidth: 5, FillHeight: 6 }
// 低两位为水平偏向，高两位为垂直偏向，与原生 ImageAlignment 一致
const imageAlignments: Readonly<Record<string, number>> = {
    TopStart: 0, TopCenter: 1, TopEnd: 2, CenterStart: 4, Center: 5, CenterEnd: 6, BottomStart: 8, BottomCenter: 9, BottomEnd: 10,
    Start: 4, CenterHorizontally: 5, End: 6, Top: 1, CenterVertically: 5, Bottom: 9,
}
export type PreparedDraw = Readonly<{ ops: Float64Array; refs: readonly unknown[] }>
const emptyPrepared: PreparedDraw = Object.freeze({ ops: new Float64Array(0), refs: Object.freeze([]) })
export type DrawCallback = (scope: DrawScope) => void
export type DrawContentCallback = (scope: DrawScope, drawContent: () => void) => void
export type DrawCacheResult = Readonly<{ onDrawBehind?: DrawCallback; onDrawWithContent?: DrawContentCallback }>
export type DrawCacheBuilder = (scope: Readonly<{ size: DrawSize }>) => DrawCacheResult
// Canvas 失效方式：auto 按读取的响应式依赖与数据源版本，manual 只由 controller 触发，frame 逐帧重录
export type CanvasInvalidation = 'auto' | 'manual' | 'frame'
export interface CanvasController {
    invalidate(): void
}
const controllers = new WeakMap<CanvasController, Set<() => void>>()

export function createCanvasController(): CanvasController {
    const listeners = new Set<() => void>()
    const controller: CanvasController = Object.freeze({ invalidate() { for (const listener of [...listeners]) listener() } })
    controllers.set(controller, listeners)
    return controller
}

export function isCanvasController(value: unknown): value is CanvasController {
    return typeof value === 'object' && value !== null && controllers.has(value as CanvasController)
}

export type DrawDeclaration = Readonly<{ draw: DrawCallback | DrawContentCallback | DrawCacheBuilder; invalidation?: CanvasInvalidation; controller?: CanvasController }>

function finite(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${name}需要有限数值`)
    return value
}
function nonnegative(value: number, name: string): number {
    if (finite(value, name) < 0) throw new RangeError(`${name}不能为负数`)
    return value
}
function synchronous(work: () => unknown): void {
    const result = work()
    if (result && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function') throw new TypeError('绘制回调必须同步完成')
}

function lookup<T extends string>(table: Readonly<Record<T, number>>, value: T, name: string): number {
    const result = Object.hasOwn(table, value) ? table[value] : undefined
    if (result === undefined) throw new TypeError(`${name}无效：${String(value)}`)
    return result
}

// 可复用的路径：动词与参数依次记录，绘制时整段写入命令流；坐标为逻辑 PX，角度为度数，0 指向右侧、顺时针
export class Path {
    private data: number[] = []
    private verbs = 0
    fillType: 'nonZero' | 'evenOdd' = 'nonZero'

    private push(verb: number, ...values: number[]): this {
        for (const value of values) finite(value, '路径坐标')
        this.data.push(verb, ...values)
        this.verbs++
        return this
    }
    moveTo(x: number, y: number): this { return this.push(PathVerb.MoveTo, x, y) }
    lineTo(x: number, y: number): this { return this.push(PathVerb.LineTo, x, y) }
    quadraticTo(x1: number, y1: number, x2: number, y2: number): this { return this.push(PathVerb.QuadTo, x1, y1, x2, y2) }
    cubicTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this { return this.push(PathVerb.CubicTo, x1, y1, x2, y2, x3, y3) }
    // 沿 rect 内切椭圆画弧；forceMoveTo 为真时另起子路径，否则从当前点连线到弧起点
    arcTo(rect: Readonly<{ x: number; y: number; width: number; height: number }>, startAngle: number, sweepAngle: number, forceMoveTo = false): this {
        nonnegative(rect.width, 'width')
        nonnegative(rect.height, 'height')
        return this.push(PathVerb.ArcTo, rect.x, rect.y, rect.width, rect.height, startAngle, sweepAngle, forceMoveTo ? 1 : 0)
    }
    close(): this { return this.push(PathVerb.Close) }
    reset(): this {
        this.data = []
        this.verbs = 0
        return this
    }
    get isEmpty(): boolean { return this.verbs === 0 }
    // 内部编码：填充规则、动词数与动词数据
    encode(): readonly number[] { return [this.fillType === 'evenOdd' ? 1 : 0, this.verbs, ...this.data] }
}

// 绘制作用域只在准备回调期间有效，所有坐标均为 JUCE 逻辑 PX
export class DrawScope {
    private active = true
    private ops = new Float64Array(64)
    private length = 0
    private readonly refs: unknown[] = []
    constructor(readonly size: DrawSize) { }

    private reserve(count: number): Float64Array {
        if (!this.active) throw new Error('绘制作用域已退出')
        if (this.length + count > this.ops.length) {
            const next = new Float64Array(Math.max(this.ops.length * 2, this.length + count))
            next.set(this.ops.subarray(0, this.length))
            this.ops = next
        }
        return this.ops
    }
    private emit(opcode: number, ...values: number[]): void {
        const ops = this.reserve(values.length + 1)
        ops[this.length++] = opcode
        for (const value of values) ops[this.length++] = value
    }
    private bounds(args: DrawRect): [number, number, number, number] {
        return [finite(args.x ?? 0, 'x'), finite(args.y ?? 0, 'y'), nonnegative(args.width ?? this.size.width, 'width'), nonnegative(args.height ?? this.size.height, 'height')]
    }
    private ref(value: unknown): number {
        this.refs.push(value)
        return this.refs.length - 1
    }
    private paint(args: DrawPaint): [number, number] {
        if ((args.color === undefined) === (args.brush === undefined)) throw new TypeError('绘制需要 color 与 brush 二选一')
        const brush = args.brush
        const slot = brush === undefined ? requireArgb(args.color!) : brush.type === 'solidColor' ? requireArgb(brush.color) : -(this.ref(brush) + 1)
        return [slot, nonnegative(args.strokeWidth ?? 0, 'strokeWidth')]
    }
    drawRect(args: DrawRect & DrawPaint): void { this.emit(DrawOpcode.Rect, ...this.bounds(args), ...this.paint(args)) }
    drawRoundRect(args: DrawRect & DrawPaint & { radius: number }): void { this.emit(DrawOpcode.RoundRect, ...this.bounds(args), ...this.paint(args), nonnegative(args.radius, 'radius')) }
    drawOval(args: DrawRect & DrawPaint): void { this.emit(DrawOpcode.Oval, ...this.bounds(args), ...this.paint(args)) }
    drawCircle(args: DrawPaint & { centerX?: number; centerY?: number; radius?: number }): void {
        const radius = nonnegative(args.radius ?? Math.min(this.size.width, this.size.height) / 2, 'radius')
        this.drawOval({ ...args, x: finite(args.centerX ?? this.size.width / 2, 'centerX') - radius, y: finite(args.centerY ?? this.size.height / 2, 'centerY') - radius, width: radius * 2, height: radius * 2 })
    }
    drawLine(args: DrawPaint & { startX: number; startY: number; endX: number; endY: number }): void {
        const [color, strokeWidth] = this.paint({ ...args, strokeWidth: args.strokeWidth ?? 1 })
        if (!strokeWidth) throw new RangeError('线宽必须大于零')
        this.emit(DrawOpcode.Line, finite(args.startX, 'startX'), finite(args.startY, 'startY'), finite(args.endX, 'endX'), finite(args.endY, 'endY'), color, strokeWidth)
    }
    drawPath(path: Path, args: DrawPathPaint): void {
        this.emit(DrawOpcode.Path, ...this.paint(args), lookup(strokeCaps, args.cap ?? 'butt', '线帽'), lookup(strokeJoins, args.join ?? 'miter', '线接'), ...path.encode())
    }
    // 文字经原生排版；width 为 0 或省略表示不限宽，字号与行高为 PX
    drawText(args: DrawTextOptions): void {
        if (typeof args.text !== 'string') throw new TypeError('drawText 需要字符串')
        const maxLines = args.maxLines ?? 0
        if (!Number.isSafeInteger(maxLines) || maxLines < 0) throw new RangeError('maxLines 需要非负整数')
        this.emit(DrawOpcode.Text, this.ref(args.text), finite(args.x ?? 0, 'x'), finite(args.y ?? 0, 'y'), nonnegative(args.width ?? 0, 'width'), requireArgb(args.color), nonnegative(args.fontSize ?? 14, 'fontSize'), nonnegative(args.lineHeight ?? 0, 'lineHeight'), maxLines, lookup(textAligns, args.textAlign ?? 'start', 'textAlign'), lookup(textOverflows, args.overflow ?? 'visible', 'overflow'))
    }
    drawPainter(painter: Painter, args: DrawPainterOptions = {}): void {
        const alpha = nonnegative(args.alpha ?? 1, 'alpha')
        if (alpha > 1) throw new RangeError('alpha 需要在 0 到 1 之间')
        if (args.tile && args.ninePatch) throw new TypeError('tile 与 ninePatch 不能同用')
        const slices = args.ninePatch ? [nonnegative(args.ninePatch.left, 'ninePatch.left'), nonnegative(args.ninePatch.top, 'ninePatch.top'), nonnegative(args.ninePatch.right, 'ninePatch.right'), nonnegative(args.ninePatch.bottom, 'ninePatch.bottom')] : [0, 0, 0, 0]
        this.emit(DrawOpcode.Painter, this.ref(painterSnapshot(painter)), ...this.bounds(args), alpha, args.tint === undefined ? -1 : requireArgb(args.tint), lookup(contentScales, args.contentScale ?? 'Fit', 'contentScale'), lookup(imageAlignments, args.alignment ?? 'Center', 'alignment'), args.tile ? 1 : args.ninePatch ? 2 : 0, ...slices)
    }
    // 按名称调用 C++ 注册的原生 painter，只画在目标矩形内；名称与参数在原生解码时按注册的参数表校验
    drawNative(name: string, args: DrawNativeOptions = {}): void {
        if (typeof name !== 'string' || !name) throw new TypeError('原生 painter 名称需要非空字符串')
        const params = args.params ?? {}
        if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new TypeError('原生 painter 参数需要对象')
        const copy: Record<string, number | boolean | string> = {}
        // 数据源版本只增不减，版本和随任一数据源推进而变，使命令不同于上一帧
        let revision = 0
        for (const [key, value] of Object.entries(params)) {
            const source = sourceStateOf(value)
            if (source) {
                noteSourceRead(source)
                revision += source.version
                copy[key] = source.name
                continue
            }
            if (typeof value === 'number') finite(value, `参数 ${key}`)
            else if (typeof value !== 'boolean' && typeof value !== 'string') throw new TypeError(`原生 painter 参数 ${key} 只能是数值、布尔、字符串或数据源`)
            copy[key] = value as number | boolean | string
        }
        this.emit(DrawOpcode.Native, this.ref(name), ...this.bounds(args), this.ref(Object.freeze(copy)), revision)
    }
    clipRect(args: DrawRect, draw: () => void): void { this.clip(DrawClipShape.Rectangle, args, 0, draw) }
    clipRoundRect(args: DrawRect & { radius: number }, draw: () => void): void { this.clip(DrawClipShape.Rounded, args, nonnegative(args.radius, 'radius'), draw) }
    clipOval(args: DrawRect, draw: () => void): void { this.clip(DrawClipShape.Oval, args, 0, draw) }
    private clip(shape: number, args: DrawRect, radius: number, draw: () => void): void {
        this.emit(DrawOpcode.Clip, shape, ...this.bounds(args), radius)
        try { synchronous(draw) } finally { this.emit(DrawOpcode.PopClip) }
    }
    clipPath(path: Path, draw: () => void): void {
        this.emit(DrawOpcode.ClipPath, ...path.encode())
        try { synchronous(draw) } finally { this.emit(DrawOpcode.PopClip) }
    }
    withTransform(args: DrawTransform, draw: () => void): void {
        this.emit(DrawOpcode.Transform, this.size.width, this.size.height, finite(args.translationX ?? 0, 'translationX'), finite(args.translationY ?? 0, 'translationY'), finite(args.scaleX ?? 1, 'scaleX'), finite(args.scaleY ?? 1, 'scaleY'), finite(args.rotationZ ?? 0, 'rotationZ'), finite(args.originX ?? 0.5, 'originX'), finite(args.originY ?? 0.5, 'originY'))
        try { synchronous(draw) } finally { this.emit(DrawOpcode.PopTransform) }
    }
    // 内部内容标记
    content(): void { this.emit(DrawOpcode.Content) }
    // 内部作用域收尾，交出定长命令与引用表
    close(): PreparedDraw {
        this.active = false
        return this.length ? Object.freeze({ ops: this.ops.slice(0, this.length), refs: Object.freeze(this.refs.slice()) }) : emptyPrepared
    }
}

// 每个最终 Layout 受体分别拥有缓存和依赖，声明自身不保存绘制状态
export class DrawInstance {
    readonly revision = shallowRef(0)
    readonly prepare: (width: number, height: number, phase?: 'prepare' | 'commit' | 'rollback') => PreparedDraw
    private readonly scope: EffectScope | undefined
    private buildEffect: ReactiveEffect
    private drawEffect: ReactiveEffect
    private readonly createEffects: () => readonly [ReactiveEffect, ReactiveEffect]
    private candidate: { build: ReactiveEffect; draw: ReactiveEffect; size: DrawSize; cache: DrawCacheResult | undefined; cacheDirty: boolean; commands: PreparedDraw } | undefined
    private size: DrawSize = Object.freeze({ width: 0, height: 0 })
    private cache: DrawCacheResult | undefined
    private cacheDirty = true
    private commands: PreparedDraw = emptyPrepared
    private stopped = false
    private readonly cleanup = () => this.stop()
    // auto 失效订阅的数据源；manual 与 frame 不登记
    private sourceWatches: readonly (() => void)[] = []
    private readonly controllerListener = () => this.invalidate()
    private frame: { scheduler: FrameScheduler; participant: FrameParticipant } | undefined

    constructor(readonly kind: string, readonly declaration: DrawDeclaration, owner?: ArrangableInstance) {
        this.scope = owner?.scope ?? getCurrentScope()
        const makeEffects = () => {
            const build = new ReactiveEffect(() => {
                const result = (declaration.draw as DrawCacheBuilder)(Object.freeze({ size: this.size }))
                if (!result || typeof result !== 'object' || Array.isArray(result) || typeof (result as { then?: unknown }).then === 'function' || Object.getOwnPropertySymbols(result).length || Object.keys(result).some(key => key !== 'onDrawBehind' && key !== 'onDrawWithContent') || result.onDrawBehind !== undefined && typeof result.onDrawBehind !== 'function' || result.onDrawWithContent !== undefined && typeof result.onDrawWithContent !== 'function') throw new TypeError('drawWithCache 需要同步返回合法的绘制回调对象')
                this.cache = result
            })
            const draw = new ReactiveEffect(() => this.record())
            return [build, draw] as const
        }
        this.createEffects = () => {
            const effects = this.scope ? this.scope.run(makeEffects) : makeEffects()
            if (!effects) throw new Error('绘制受体作用域已经退休')
            effects[0].scheduler = () => {
                this.cacheDirty = true
                if (this.candidate?.build === effects[0]) this.candidate.cacheDirty = true
                this.invalidate()
            }
            effects[1].scheduler = () => this.invalidate()
            return effects
        }
        const effects = this.createEffects();
        [this.buildEffect, this.drawEffect] = effects
        this.prepare = (width, height, phase) => {
            if (phase === 'commit' || phase === 'rollback') {
                this.finish(phase === 'commit')
                return emptyPrepared
            }
            if (this.stopped || this.scope && (!this.scope.active || this.scope.paused)) throw new Error('不能准备已退休或停用的绘制受体')
            width = nonnegative(width, '绘制宽度')
            height = nonnegative(height, '绘制高度')
            if (phase === 'prepare') {
                this.finish(false)
                this.candidate = { build: this.buildEffect, draw: this.drawEffect, size: this.size, cache: this.cache, cacheDirty: this.cacheDirty, commands: this.commands }
                const [build, draw] = this.createEffects()
                this.drawEffect = draw
                if (kind === 'drawWithCache' && (this.cacheDirty || width !== this.size.width || height !== this.size.height)) this.buildEffect = build
                else this.stopEffect(build)
            }
            if (width !== this.size.width || height !== this.size.height) {
                this.size = Object.freeze({ width, height })
                this.cacheDirty = true
            }
            if (kind === 'drawWithCache' && this.cacheDirty) {
                this.buildEffect.run()
                this.cacheDirty = false
            }
            this.drawEffect.run()
            return this.commands
        }
        this.scope?.cleanups.push(this.cleanup)
        if (declaration.controller) controllers.get(declaration.controller)?.add(this.controllerListener)
        if (declaration.invalidation === 'frame') {
            const scheduler = findFrameScheduler()
            if (scheduler) {
                const participant: FrameParticipant = {
                    sample: () => this.invalidate(),
                    active: () => !this.stopped && (!this.scope || this.scope.active && !this.scope.paused),
                }
                scheduler.add(participant)
                this.frame = { scheduler, participant }
            }
        }
    }
    private finish(success: boolean): void {
        const previous = this.candidate
        if (!previous) return
        this.candidate = undefined
        if (success) {
            if (previous.build !== this.buildEffect) this.stopEffect(previous.build)
            if (previous.draw !== this.drawEffect) this.stopEffect(previous.draw)
        } else {
            if (previous.build !== this.buildEffect) this.stopEffect(this.buildEffect)
            if (previous.draw !== this.drawEffect) this.stopEffect(this.drawEffect)
            this.buildEffect = previous.build
            this.drawEffect = previous.draw
            this.size = previous.size
            this.cache = previous.cache
            this.cacheDirty = previous.cacheDirty
            this.commands = previous.commands
        }
    }
    private stopEffect(effect: ReactiveEffect): void {
        effect.stop()
        if (this.scope) {
            const index = this.scope.effects.indexOf(effect)
            if (index >= 0) this.scope.effects.splice(index, 1)
        }
    }
    private invalidate(): void { if (!this.stopped) this.revision.value++ }
    private record(): void {
        const scope = new DrawScope(this.size)
        let completed = false
        const tracked = (this.declaration.invalidation ?? 'auto') === 'auto'
        if (!tracked) pauseTracking()
        let sources: ReadonlySet<DataSourceState> = new Set()
        try {
            [, sources] = collectSourceReads(() => this.recordInto(scope))
            completed = true
        } finally {
            if (!tracked) resetTracking()
            const prepared = scope.close()
            this.commands = completed ? prepared : emptyPrepared
            this.watchSources(tracked ? sources : new Set())
        }
    }
    private watchSources(sources: ReadonlySet<DataSourceState>): void {
        for (const stop of this.sourceWatches) stop()
        this.sourceWatches = [...sources].map(source => source.watch(() => this.invalidate()))
    }
    private recordInto(scope: DrawScope): void {
        if (this.kind === 'drawWithCache') {
            if (this.cache?.onDrawBehind) synchronous(() => this.cache!.onDrawBehind!(scope))
            if (this.cache?.onDrawWithContent) synchronous(() => this.cache!.onDrawWithContent!(scope, () => scope.content()))
            else scope.content()
        } else if (this.kind === 'drawBehind') {
            synchronous(() => (this.declaration.draw as DrawCallback)(scope))
            scope.content()
        } else synchronous(() => (this.declaration.draw as DrawContentCallback)(scope, () => scope.content()))
    }
    stop(): void {
        if (this.stopped) return
        this.finish(false)
        this.stopped = true
        this.stopEffect(this.buildEffect)
        this.stopEffect(this.drawEffect)
        if (this.scope) {
            const index = this.scope.cleanups.indexOf(this.cleanup)
            if (index >= 0) this.scope.cleanups.splice(index, 1)
        }
        this.watchSources(new Set())
        if (this.declaration.controller) controllers.get(this.declaration.controller)?.delete(this.controllerListener)
        if (this.frame) this.frame.scheduler.remove(this.frame.participant)
        this.frame = undefined
        this.cache = undefined
        this.commands = emptyPrepared
    }
}
