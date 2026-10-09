import { getCurrentScope, ReactiveEffect, shallowRef, type EffectScope } from '@arrange/reactivity'
import { requireArgb } from './color.ts'
import type { ArrangableInstance } from './runtime/internal.ts'

export type DrawSize = Readonly<{ width: number; height: number }>
export type DrawRect = Readonly<{ x?: number; y?: number; width?: number; height?: number }>
export type DrawPaint = Readonly<{ color: number; strokeWidth?: number }>
export type DrawTransform = Readonly<{ translationX?: number; translationY?: number; scaleX?: number; scaleY?: number; rotationZ?: number; originX?: number; originY?: number }>
type DrawCommand = Readonly<Record<string, number | string>>
export type DrawCallback = (scope: DrawScope) => void
export type DrawContentCallback = (scope: DrawScope, drawContent: () => void) => void
export type DrawCacheResult = Readonly<{ onDrawBehind?: DrawCallback; onDrawWithContent?: DrawContentCallback }>
export type DrawCacheBuilder = (scope: Readonly<{ size: DrawSize }>) => DrawCacheResult
export type DrawDeclaration = Readonly<{ draw: DrawCallback | DrawContentCallback | DrawCacheBuilder }>

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

// 绘制作用域只在准备回调期间有效，所有坐标均为 JUCE 逻辑 PX
export class DrawScope {
    private active = true
    constructor(readonly size: DrawSize, private readonly commands: DrawCommand[]) { }

    private emit(command: DrawCommand): void {
        if (!this.active) throw new Error('绘制作用域已退出')
        this.commands.push(Object.freeze(command))
    }
    private bounds(args: DrawRect): { x: number; y: number; width: number; height: number } {
        return { x: finite(args.x ?? 0, 'x'), y: finite(args.y ?? 0, 'y'), width: nonnegative(args.width ?? this.size.width, 'width'), height: nonnegative(args.height ?? this.size.height, 'height') }
    }
    private paint(args: DrawPaint): { color: number; strokeWidth: number } {
        requireArgb(args.color)
        return { color: args.color, strokeWidth: nonnegative(args.strokeWidth ?? 0, 'strokeWidth') }
    }
    drawRect(args: DrawRect & DrawPaint): void { this.emit({ kind: 'rect', ...this.bounds(args), ...this.paint(args) }) }
    drawRoundRect(args: DrawRect & DrawPaint & { radius: number }): void { this.emit({ kind: 'roundRect', ...this.bounds(args), ...this.paint(args), radius: nonnegative(args.radius, 'radius') }) }
    drawOval(args: DrawRect & DrawPaint): void { this.emit({ kind: 'oval', ...this.bounds(args), ...this.paint(args) }) }
    drawCircle(args: DrawPaint & { centerX?: number; centerY?: number; radius?: number }): void {
        const radius = nonnegative(args.radius ?? Math.min(this.size.width, this.size.height) / 2, 'radius')
        this.drawOval({ ...args, x: finite(args.centerX ?? this.size.width / 2, 'centerX') - radius, y: finite(args.centerY ?? this.size.height / 2, 'centerY') - radius, width: radius * 2, height: radius * 2 })
    }
    drawLine(args: DrawPaint & { startX: number; startY: number; endX: number; endY: number }): void {
        const paint = this.paint({ ...args, strokeWidth: args.strokeWidth ?? 1 })
        if (!paint.strokeWidth) throw new RangeError('线宽必须大于零')
        this.emit({ kind: 'line', x: finite(args.startX, 'startX'), y: finite(args.startY, 'startY'), endX: finite(args.endX, 'endX'), endY: finite(args.endY, 'endY'), ...paint })
    }
    clipRect(args: DrawRect, draw: () => void): void { this.clip('rectangle', args, 0, draw) }
    clipRoundRect(args: DrawRect & { radius: number }, draw: () => void): void { this.clip('rounded', args, nonnegative(args.radius, 'radius'), draw) }
    clipOval(args: DrawRect, draw: () => void): void { this.clip('circle', args, 0, draw) }
    private clip(shape: string, args: DrawRect, radius: number, draw: () => void): void {
        this.emit({ kind: 'clip', shape, ...this.bounds(args), radius })
        try { synchronous(draw) } finally { this.emit({ kind: 'popClip' }) }
    }
    withTransform(args: DrawTransform, draw: () => void): void {
        this.emit({
            kind: 'transform', width: this.size.width, height: this.size.height,
            translationX: finite(args.translationX ?? 0, 'translationX'), translationY: finite(args.translationY ?? 0, 'translationY'),
            scaleX: finite(args.scaleX ?? 1, 'scaleX'), scaleY: finite(args.scaleY ?? 1, 'scaleY'), rotationZ: finite(args.rotationZ ?? 0, 'rotationZ'),
            originX: finite(args.originX ?? 0.5, 'originX'), originY: finite(args.originY ?? 0.5, 'originY')
        })
        try { synchronous(draw) } finally { this.emit({ kind: 'popTransform' }) }
    }
    // 内部内容标记
    content(): void { this.emit({ kind: 'content' }) }
    // 内部作用域收尾
    close(): void { this.active = false }
}

// 每个最终 Layout 受体分别拥有缓存和依赖，声明自身不保存绘制状态
export class DrawInstance {
    readonly revision = shallowRef(0)
    readonly prepare: (width: number, height: number, phase?: 'prepare' | 'commit' | 'rollback') => readonly DrawCommand[]
    private readonly scope: EffectScope | undefined
    private buildEffect: ReactiveEffect
    private drawEffect: ReactiveEffect
    private readonly createEffects: () => readonly [ReactiveEffect, ReactiveEffect]
    private candidate: { build: ReactiveEffect; draw: ReactiveEffect; size: DrawSize; cache: DrawCacheResult | undefined; cacheDirty: boolean; commands: DrawCommand[] } | undefined
    private size: DrawSize = Object.freeze({ width: 0, height: 0 })
    private cache: DrawCacheResult | undefined
    private cacheDirty = true
    private commands: DrawCommand[] = []
    private stopped = false
    private readonly cleanup = () => this.stop()

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
                return []
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
            return Object.freeze(this.commands)
        }
        this.scope?.cleanups.push(this.cleanup)
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
        const commands = this.commands = []
        const scope = new DrawScope(this.size, commands)
        try {
            if (this.kind === 'drawWithCache') {
                if (this.cache?.onDrawBehind) synchronous(() => this.cache!.onDrawBehind!(scope))
                if (this.cache?.onDrawWithContent) synchronous(() => this.cache!.onDrawWithContent!(scope, () => scope.content()))
                else scope.content()
            } else if (this.kind === 'drawBehind') {
                synchronous(() => (this.declaration.draw as DrawCallback)(scope))
                scope.content()
            } else synchronous(() => (this.declaration.draw as DrawContentCallback)(scope, () => scope.content()))
        } finally { scope.close() }
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
        this.cache = undefined
        this.commands = []
    }
}
