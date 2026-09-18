import type { ComponentInternalInstance } from './component.ts'

import { setBlockTracking } from './vnode.ts'

/**
 * mark the current rendering instance for asset resolution (e.g.
 * resolveComponent, resolveDirective) during render
 */
export let currentRenderingInstance: ComponentInternalInstance | null = null

/**
 * Note: rendering calls maybe nested. The function returns the parent rendering
 * instance if present, which should be restored after the render is done:
 *
 * ```js
 * const prev = setCurrentRenderingInstance(i)
 * // ...render
 * setCurrentRenderingInstance(prev)
 * ```
 */
export function setCurrentRenderingInstance(
    instance: ComponentInternalInstance | null,
): ComponentInternalInstance | null {
    const prev = currentRenderingInstance
    currentRenderingInstance = instance

    return prev
}

export type ContextualRenderFn = {
    (...args: any[]): any
    _n: boolean /* already normalized */
    _c: boolean /* compiled */
    _d: boolean /* disableTracking */
}

/**
 * Wrap a slot function to memoize current rendering instance
 * @private compiler helper
 */
export function withCtx(
    fn: Function,
    ctx: ComponentInternalInstance | null = currentRenderingInstance,
): Function {
    if (!ctx) return fn

    // already normalized
    if ((fn as ContextualRenderFn)._n) {
        return fn
    }

    const renderFnWithContext: ContextualRenderFn = (...args: any[]) => {
        // If a user calls a compiled slot inside a template expression (#1745), it
        // can mess up block tracking, so by default we disable block tracking and
        // force bail out when invoking a compiled slot (indicated by the ._d flag).
        // This isn't necessary if rendering a compiled `<slot>`, so we flip the
        // ._d flag off when invoking the wrapped fn inside `renderSlot`.
        if (renderFnWithContext._d) {
            setBlockTracking(-1)
        }
        const prevInstance = setCurrentRenderingInstance(ctx)
        let res
        try {
            res = fn(...args)
        } finally {
            setCurrentRenderingInstance(prevInstance)
            if (renderFnWithContext._d) {
                setBlockTracking(1)
            }
        }

        return res
    }

    // mark normalized to avoid duplicated wrapping
    renderFnWithContext._n = true
    // mark this as compiled by default
    // this is used in vnode.ts -> normalizeChildren() to set the slot
    // rendering flag.
    renderFnWithContext._c = true
    // disable block tracking by default
    renderFnWithContext._d = true
    // compat build only flag to distinguish scoped slots from non-scoped ones

    return renderFnWithContext
}
