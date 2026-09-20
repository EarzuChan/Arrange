import type { ReactiveEffect } from './effect.ts'
import { warn } from './warning.ts'

export let activeEffectScope: EffectScope | undefined

export class EffectScope {
  /**
   * @internal
   */
  private _active = true
  /**
   * @internal track `on` calls, allow `on` call multiple times
   */
  private _on = 0
  /**
   * @internal
   */
  effects: ReactiveEffect[] = []
  /**
   * @internal
   */
  cleanups: (() => void)[] = []

  private _isPaused = false
  private _warnOnRun = true

  /**
   * only assigned by undetached scope
   * @internal
   */
  parent: EffectScope | undefined
  /**
   * record undetached scopes
   * @internal
   */
  scopes: EffectScope[] | undefined
  /**
   * track a child scope's index in its parent's scopes array for optimized
   * removal
   * @internal
   */
  private index: number | undefined

  readonly __v_skip = true
  // TODO isolatedDeclarations ReactiveFlags.SKIP

  constructor(public detached = false) {
    if (!detached && activeEffectScope) {
      if (activeEffectScope.active) {
        this.parent = activeEffectScope
        this.index =
          (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
            this,
          ) - 1
      } else {
        // The parent scope has already stopped, so this child must not become
        // a detached live scope.
        this._active = false
        this._warnOnRun = false
      }
    }
  }

  get active(): boolean {
    return this._active
  }

  pause(): void {
    if (this._active) {
      this._isPaused = true
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

  /**
   * Resumes the effect scope, including all child scopes and effects.
   */
  resume(): void {
    if (this._active) {
      if (this._isPaused) {
        this._isPaused = false
        let i, l
        if (this.scopes) {
          for (i = 0, l = this.scopes.length; i < l; i++) {
            this.scopes[i].resume()
          }
        }
        for (i = 0, l = this.effects.length; i < l; i++) {
          this.effects[i].resume()
        }
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
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on(): void {
    if (++this._on === 1) {
      this.prevScope = activeEffectScope
      activeEffectScope = this
    }
  }

  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off(): void {
    if (this._on > 0 && --this._on === 0) {
      // Fast path: in the common LIFO case this scope is still at the top
      // of the active chain, so we can restore the previous scope directly.
      if (activeEffectScope === this) {
        activeEffectScope = this.prevScope
      } else {
        // withAsyncContext() restores the current arrangable scope for the
        // current async continuation, then defers its cleanup to a microtask.
        // If sibling continuations interleave (A restore -> B restore ->
        // A cleanup), activeEffectScope is already B instead of this scope A
        // when A's cleanup calls off(). Unlink A from the middle of the
        // active chain so a stale scope doesn't remain globally reachable.
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

        this.parent = undefined

        if (errors.length) throw new AggregateError(errors, '反应式作用域停止时发生清理错误')
    }
}

/**
 * Creates an effect scope object which can capture the reactive effects (i.e.
 * computed and watchers) created within it so that these effects can be
 * disposed together. For detailed use cases of this API, please consult its
 * corresponding {@link https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md | RFC}.
 *
 * @param detached - Can be used to create a "detached" effect scope.
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#effectscope}
 */
export function effectScope(detached?: boolean): EffectScope {
  return new EffectScope(detached)
}

/**
 * Returns the current active effect scope if there is one.
 *
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#getcurrentscope}
 */
export function getCurrentScope(): EffectScope | undefined {
  return activeEffectScope
}

/**
 * Registers a dispose callback on the current active effect scope. The
 * callback will be invoked when the associated effect scope is stopped.
 *
 * @param fn - The callback function to attach to the scope's cleanup.
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#onscopedispose}
 */
export function onScopeDispose(fn: () => void, failSilently = false): void {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  } else if (__DEV__ && !failSilently) {
    warn(
      `onScopeDispose() is called when there is no active effect scope` +
        ` to be associated with.`,
    )
  }
}
