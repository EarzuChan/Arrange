// Core API ------------------------------------------------------------------

export const version: string = __VERSION__
export {
    EffectScope, ReactiveEffect,
    // advanced
    customRef,
    // effect
    effect,
    // effect scope
    effectScope, getCurrentScope, getCurrentWatcher, isProxy,
    isReactive,
    isReadonly, isRef, isShallow, markRaw, onScopeDispose, onWatcherCleanup, proxyRefs,
    // core
    reactive, readonly, ref, shallowReactive,
    shallowReadonly, shallowRef, stop, toRaw, toRef, toRefs, toValue, triggerRef,
    // utilities
    unref
} from '@arrange/vue-reactivity'
export { defineAsyncArrangable } from './apiAsyncArrangable.ts'
export { computed } from './apiComputed.ts'
export { defineArrangable } from './apiDefineArrangable.ts'
export { hasInjectionContext, inject, provide } from './apiInject.ts'
export {
    onActivated, onBeforeMount, onBeforeUnmount, onBeforeUpdate, onDeactivated, onErrorCaptured, onMounted, onRenderTracked,
    onRenderTriggered, onUnmounted, onUpdated
} from './apiLifecycle.ts'
export { useSlots } from './apiSetupHelpers.ts'
export {
    watch,
    watchEffect,
    watchPostEffect,
    watchSyncEffect
} from './apiWatch.ts'
export { useId } from './helpers/useId.ts'
export { nextTick } from './scheduler.ts'

// <script setup> API ----------------------------------------------------------
export {
    // macros runtime, for typing and warnings only
    type DefineProps, defineProps, withDefaults
} from './apiSetupHelpers.ts'

/**
 * @internal
 */
export {
    createPropsRestProxy, mergeDefaults,
} from './apiSetupHelpers.ts'

// Advanced API ----------------------------------------------------------------

// For getting a hold of the internal instance in setup() - useful for advanced
// plugins
export { getCurrentInstance } from './arrangable.ts'

// For raw render function users
export { h } from './h.ts'
// Advanced render function utilities
export { cloneVNode, createVNode, isVNode, mergeProps } from './vnode.ts'

// VNode types
export { Comment, Fragment } from './vnode.ts'

// Built-in arrangables

// Custom Renderer API ---------------------------------------------------------
export { createRenderer } from './renderer.ts'
export { queuePostFlushCb } from './scheduler.ts'

import { warn as _warn } from './warning.ts'
export const warn = (__DEV__ ? _warn : NOOP) as typeof _warn

/** @internal */
export {
    ErrorCodes, callWithAsyncErrorHandling, callWithErrorHandling, handleError
} from './errorHandling.ts'
export {
    resolveArrangable,
    resolveDynamicArrangable
} from './helpers/resolveAssets.ts'
export { assertNumber } from './warning.ts'


import { ErrorTypeStrings as _ErrorTypeStrings } from './errorHandling.ts'
/**
 * Runtime error messages. Only exposed in dev or esm builds.
 * @internal
 */
export const ErrorTypeStrings = (
    (_ErrorTypeStrings)
) as typeof _ErrorTypeStrings

// Types -----------------------------------------------------------------------
import type { ArrangableInstance } from './arrangable.ts'
import type { VNode } from './vnode.ts'

// Augment Ref unwrap bail types.
declare module '@arrange/vue-reactivity' {
    export interface RefUnwrapBailTypes {
        runtimeCoreBailTypes:
        | VNode
        | {
            // directly bailing on ArrangablePublicInstance results in recursion
            // so we use this as a bail hint
            $: ArrangableInstance
        }
    }
}
export { TrackOpTypes, TriggerOpTypes } from '@arrange/vue-reactivity'
export type {
    ComputedGetter, ComputedRef, ComputedSetter, CustomRefFactory, DebuggerEvent,
    DebuggerEventExtraInfo, DebuggerOptions, DeepReadonly, EffectScheduler, MaybeRef,
    MaybeRefOrGetter, Raw,
    Reactive, ReactiveEffectOptions, ReactiveEffectRunner, ReactiveFlags, Ref, ShallowReactive, ShallowRef,
    ShallowUnwrapRef, ToRef,
    ToRefs, UnwrapNestedRefs, UnwrapRef, WritableComputedOptions, WritableComputedRef
} from '@arrange/vue-reactivity'
export type {
    AsyncArrangableLoader, AsyncArrangableOptions
} from './apiAsyncArrangable.ts'
export type {
    App,
    AppConfig,
    AppContext, CreateAppFunction, FunctionPlugin, ObjectPlugin, Plugin
} from './apiCreateApp.ts'
export type {
    DefineArrangable,
    DefineSetupFnArrangable,
    PublicProps
} from './apiDefineArrangable.ts'
export type { InjectionKey } from './apiInject.ts'
export type {
    MultiWatchSources, WatchCallback, WatchEffect, WatchHandle, WatchOptions,
    WatchEffectOptions as WatchOptionsBase, WatchSource, WatchStopHandle
} from './apiWatch.ts'
export type {
    Arrangable, ArrangableInstance, ConcreteArrangable,
    FunctionalArrangable, GlobalArrangables,
    SetupContext
} from './arrangable.ts'
export type {
    ArrangableOptions, ArrangableOptionsBase, RenderFunction
} from './arrangableOptions.ts'
export type {
    ArrangableObjectPropsOptions, ArrangablePropsOptions, ExtractDefaultPropTypes, ExtractPropTypes,
    ExtractPublicPropTypes, Prop,
    PropType
} from './arrangableProps.ts'
export type {
    ArrangableCustomProperties, ArrangablePublicInstance
} from './arrangablePublicInstance.ts'
export type { Slot, Slots, SlotsType } from './arrangableSlots.ts'
export type { HMRRuntime } from './hmr.ts'
export type {
    Renderer, RendererElement, RendererNode, RendererOptions,
    RootRenderFunction
} from './renderer.ts'
export type {
    VNode, VNodeArrayChildren, VNodeChild, VNodeNormalizedChildren, VNodeProps, VNodeTypes
} from './vnode.ts'

// Internal API ----------------------------------------------------------------

// **IMPORTANT** Internal APIs may change without notice between versions and
// user code should avoid relying on them.

// For compiler generated code
// should sync with '@arrange/vue-compiler-core/src/runtimeHelpers.ts'
export {
    camelize,
    arrangeParameterName,
    capitalize
} from '@arrange/vue-shared'
export {
    withCtx
} from './arrangableRenderContext.ts'
export { createSlots } from './helpers/createSlots.ts'
export { arrangeParameters } from './propDeclarations.ts'
export { renderList } from './helpers/renderList.ts'
export { renderSlot } from './helpers/renderSlot.ts'
export {
    createBlock, createCommentVNode, createElementBlock, createElementVNode, guardReactiveProps, openBlock, setBlockTracking
} from './vnode.ts'

// For test-utils
export { transformVNodeArgs } from './vnode.ts'

export { getArrangeExecutionStats } from './executionStats.ts'
export { arrangeProps, arrangeValue } from './valueBinding.ts'

import { NOOP } from '@arrange/vue-shared'

export { isValueExpression } from './valueBinding.ts'
export type { ValueExpression } from './valueBinding.ts'

export { defineFoundationArrangable } from './apiDefineFoundationArrangable.ts'

