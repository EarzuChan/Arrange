export const ARRANGE_PROPS: unique symbol = Symbol('arrangeProps')
export const ARRANGE_PARAMETER_NAME: unique symbol = Symbol('arrangeParameterName')
export const FRAGMENT: unique symbol = Symbol(__DEV__ ? `Fragment` : ``)
export const OPEN_BLOCK: unique symbol = Symbol(__DEV__ ? `openBlock` : ``)
export const CREATE_BLOCK: unique symbol = Symbol(__DEV__ ? `createBlock` : ``)
export const CREATE_ELEMENT_BLOCK: unique symbol = Symbol(
    __DEV__ ? `createElementBlock` : ``,
)
export const CREATE_VNODE: unique symbol = Symbol(__DEV__ ? `createVNode` : ``)
export const CREATE_ELEMENT_VNODE: unique symbol = Symbol(
    __DEV__ ? `createElementVNode` : ``,
)
export const CREATE_COMMENT: unique symbol = Symbol(
    __DEV__ ? `createCommentVNode` : ``,
)
export const RESOLVE_ARRANGABLE: unique symbol = Symbol(
    __DEV__ ? `resolveArrangable` : ``,
)
export const RESOLVE_DYNAMIC_ARRANGABLE: unique symbol = Symbol(
    __DEV__ ? `resolveDynamicArrangable` : ``,
)
export const RENDER_LIST: unique symbol = Symbol(__DEV__ ? `renderList` : ``)
export const RENDER_SLOT: unique symbol = Symbol(__DEV__ ? `renderSlot` : ``)
export const CREATE_SLOTS: unique symbol = Symbol(__DEV__ ? `createSlots` : ``)
export const ARRANGE_MODIFIER: unique symbol = Symbol('arrangeModifier')
export const ARRANGE_VALUE: unique symbol = Symbol('arrangeValue')
export const ARRANGE_PARAMETERS: unique symbol = Symbol('arrangeParameters')
export const MERGE_PROPS: unique symbol = Symbol(__DEV__ ? `mergeProps` : ``)
export const GUARD_REACTIVE_PROPS: unique symbol = Symbol(
    __DEV__ ? `guardReactiveProps` : ``,
)
export const CAMELIZE: unique symbol = Symbol(__DEV__ ? `camelize` : ``)
export const CAPITALIZE: unique symbol = Symbol(__DEV__ ? `capitalize` : ``)
export const SET_BLOCK_TRACKING: unique symbol = Symbol(
    __DEV__ ? `setBlockTracking` : ``,
)
/**
 * @deprecated no longer needed in 3.5+ because we no longer hoist element nodes
 * but kept for backwards compat
 */
/**
 * @deprecated kept for backwards compat
 */
export const WITH_CTX: unique symbol = Symbol(__DEV__ ? `withCtx` : ``)
export const UNREF: unique symbol = Symbol(__DEV__ ? `unref` : ``)
export const IS_REF: unique symbol = Symbol(__DEV__ ? `isRef` : ``)

// Name mapping for runtime helpers that need to be imported from 'vue' in
// generated code. Make sure these are correctly exported in the runtime!
export const helperNameMap: Record<symbol, string> = {
    [ARRANGE_PROPS]: `arrangeProps`,
    [ARRANGE_PARAMETER_NAME]: `arrangeParameterName`,
    [FRAGMENT]: `Fragment`,
    [OPEN_BLOCK]: `openBlock`,
    [CREATE_BLOCK]: `createBlock`,
    [CREATE_ELEMENT_BLOCK]: `createElementBlock`,
    [CREATE_VNODE]: `createVNode`,
    [CREATE_ELEMENT_VNODE]: `createElementVNode`,
    [CREATE_COMMENT]: `createCommentVNode`,
    [RESOLVE_ARRANGABLE]: `resolveArrangable`,
    [RESOLVE_DYNAMIC_ARRANGABLE]: `resolveDynamicArrangable`,
    [RENDER_LIST]: `renderList`,
    [RENDER_SLOT]: `renderSlot`,
    [CREATE_SLOTS]: `createSlots`,
    [MERGE_PROPS]: `mergeProps`,
    [ARRANGE_MODIFIER]: `arrangeModifier`,
    [ARRANGE_VALUE]: `arrangeValue`,
    [ARRANGE_PARAMETERS]: `arrangeParameters`,
    [GUARD_REACTIVE_PROPS]: `guardReactiveProps`,
    [CAMELIZE]: `camelize`,
    [CAPITALIZE]: `capitalize`,
    [SET_BLOCK_TRACKING]: `setBlockTracking`,
    [WITH_CTX]: `withCtx`,
    [UNREF]: `unref`,
    [IS_REF]: `isRef`,
}

export function registerRuntimeHelpers(helpers: Record<symbol, string>): void {
    Object.getOwnPropertySymbols(helpers).forEach(s => {
        helperNameMap[s] = helpers[s]
    })
}
