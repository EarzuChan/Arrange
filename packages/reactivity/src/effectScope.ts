import { ReactiveFlags } from './constants.ts'
import type { ReactiveEffect } from './effect.ts'
import { warn } from './warning.ts'

export let activeEffectScope: EffectScope | undefined

export class EffectScope {
    private _active = true
    private _on = 0
    effects: ReactiveEffect[] = []
    cleanups: (() => void)[] = []

    readonly pauseCallbacks = new Set<() => void>()
    readonly resumeCallbacks = new Set<() => void>()

    private _isPaused = false
    private _warnOnRun = true

    parent: EffectScope | undefined
    scopes: EffectScope[] | undefined
    private index: number | undefined

    readonly [ReactiveFlags.SKIP] = true

    constructor(public detached = false) {
        if (!detached && activeEffectScope) {
            if (activeEffectScope.active) {
                this.parent = activeEffectScope
                this.index =
                    (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
                        this,
                    ) - 1
            } else {
                this._active = false
                this._warnOnRun = false
            }
        }
    }

    get active(): boolean {
        return this._active
    }

    get paused(): boolean { return this._isPaused }

    pause(): void {
        if (this._active && !this._isPaused) {
            this._isPaused = true
            for (const callback of this.pauseCallbacks) callback()
            let i, l
            if (this.scopes) {
                for (i = 0, l = this.scopes.length; i < l; i++) {
                    this.scopes[i].pause()
                }
            }
            for (i = 0, l = this.effects.length; i < l; i++) {
                this.effects[i].pause()
            }
        }
    }

    resume(): void {
        if (this._active) {
            if (this._isPaused) {
                this._isPaused = false
                for (const callback of this.resumeCallbacks) callback()
                let i, l
                if (this.scopes) for (i = 0, l = this.scopes.length; i < l; i++) this.scopes[i].resume()
                for (i = 0, l = this.effects.length; i < l; i++) this.effects[i].resume()
            }
        }
    }

    run<T>(fn: () => T): T | undefined {
        if (this._active) {
            const currentEffectScope = activeEffectScope
            try {
                activeEffectScope = this
                return fn()
            } finally {
                activeEffectScope = currentEffectScope
            }
        } else if (__DEV__ && this._warnOnRun) {
            warn(`cannot run an inactive effect scope.`)
        }
    }

    prevScope: EffectScope | undefined
    on(): void {
        if (++this._on === 1) {
            this.prevScope = activeEffectScope
            activeEffectScope = this
        }
    }

    off(): void {
        if (this._on > 0 && --this._on === 0) {
            if (activeEffectScope === this) {
                activeEffectScope = this.prevScope
            } else {
                let current = activeEffectScope
                while (current) {
                    if (current.prevScope === this) {
                        current.prevScope = this.prevScope
                        break
                    }
                    current = current.prevScope
                }
            }
            this.prevScope = undefined
        }
    }

    stop(fromParent?: boolean): void {
        if (!this._active) return

        this._active = false
        const errors: unknown[] = []

        const safely = (operation: () => void) => { try { operation() } catch (error) { errors.push(error) } }

        // 清理可能主动移除 effect，使用快照保证每项恰好得到一次停止机会
        const effects = this.effects.splice(0)
        const cleanups = this.cleanups.splice(0)
        const scopes = this.scopes?.splice(0) ?? []
        for (const effect of effects) safely(() => effect.stop())
        for (const cleanup of cleanups) safely(cleanup)
        for (const scope of scopes) safely(() => scope.stop(true))

        if (!this.detached && this.parent && !fromParent) {
            const last = this.parent.scopes!.pop()
            if (last && last !== this) {
                this.parent.scopes![this.index!] = last
                last.index = this.index!
            }
        }

        this.pauseCallbacks.clear()
        this.resumeCallbacks.clear()
        this.parent = undefined

        if (errors.length) throw new AggregateError(errors, '反应式作用域停止时发生清理错误')
    }
}

// 收集副作用和清理；detached 作用域由创建者独立负责退休
export function effectScope(detached?: boolean): EffectScope {
    return new EffectScope(detached)
}

// 读取当前执行上下文的作用域
export function getCurrentScope(): EffectScope | undefined {
    return activeEffectScope
}

// 将资源清理归属当前作用域，停止时执行一次
export function onScopeDispose(fn: () => void, failSilently = false): void {
    if (activeEffectScope) {
        activeEffectScope.cleanups.push(fn)
    } else if (__DEV__ && !failSilently) {
        warn(`onScopeDispose() is called when there is no active effect scope` + ` to be associated with.`)
    }
}
