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
export { defineAsyncComponent } from './apiAsyncComponent.ts'
export { computed } from './apiComputed.ts'
export { defineComponent } from './apiDefineComponent.ts'
export { hasInjectionContext, inject, provide } from './apiInject.ts'
export {
    onActivated, onBeforeMount, onBeforeUnmount, onBeforeUpdate, onDeactivated, onErrorCaptured, onMounted, onRenderTracked,
    onRenderTriggered, onUnmounted, onUpdated
} from './apiLifecycle.ts'
export { useAttrs, useSlots } from './apiSetupHelpers.ts'
export {
    watch,
    watchEffect,
    watchPostEffect,
    watchSyncEffect
} from './apiWatch.ts'
export { useId } from './helpers/useId.ts'
export { useModel } from './helpers/useModel.ts'
export { type TemplateRef, useTemplateRef } from './helpers/useTemplateRef.ts'
export { nextTick } from './scheduler.ts'

// <script setup> API ----------------------------------------------------------
export {
    type ComponentTypeEmits, type DefineProps,
    type ModelRef, defineEmits,
    defineExpose, defineModel, defineOptions,
    // macros runtime, for typing and warnings only
    defineProps, defineSlots, withDefaults
} from './apiSetupHelpers.ts'

/**
 * @internal
 */
export {
    createPropsRestProxy, mergeDefaults,
    mergeModels, withAsyncContext
} from './apiSetupHelpers.ts'

// Advanced API ----------------------------------------------------------------

// For getting a hold of the internal instance in setup() - useful for advanced
// plugins
export { getCurrentInstance } from './component.ts'

// For raw render function users
export { h } from './h.ts'
// Advanced render function utilities
export { cloneVNode, createVNode, isVNode, mergeProps } from './vnode.ts'

// VNode types
export { Comment, Fragment, Static, Text, type VNodeRef } from './vnode.ts'

// Built-in components
export {
    BaseTransition, type BaseTransitionProps, BaseTransitionPropsValidators
} from './components/BaseTransition.ts'
export { KeepAlive, type KeepAliveProps } from './components/KeepAlive.ts'
export { Suspense, type SuspenseProps } from './components/Suspense.ts'
export { Teleport, type TeleportProps } from './components/Teleport.ts'

// For using custom directives
export { withDirectives } from './directives.ts'

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
    resolveComponent,
    resolveDirective,
    resolveDynamicComponent
} from './helpers/resolveAssets.ts'
export { assertNumber } from './warning.ts'

export {
    getTransitionRawChildren, resolveTransitionHooks,
    setTransitionHooks, useTransitionState
} from './components/BaseTransition.ts'

import { ErrorTypeStrings as _ErrorTypeStrings } from './errorHandling.ts'
/**
 * Runtime error messages. Only exposed in dev or esm builds.
 * @internal
 */
export const ErrorTypeStrings = (
    (_ErrorTypeStrings)
) as typeof _ErrorTypeStrings

// Types -----------------------------------------------------------------------
import type { ComponentInternalInstance } from './component.ts'
import type { VNode } from './vnode.ts'

// Augment Ref unwrap bail types.
declare module '@arrange/vue-reactivity' {
    export interface RefUnwrapBailTypes {
        runtimeCoreBailTypes:
        | VNode
        | {
            // directly bailing on ComponentPublicInstance results in recursion
            // so we use this as a bail hint
            $: ComponentInternalInstance
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
    AsyncComponentLoader, AsyncComponentOptions
} from './apiAsyncComponent.ts'
export type {
    App,
    AppConfig,
    AppContext, CreateAppFunction, FunctionPlugin, ObjectPlugin, Plugin
} from './apiCreateApp.ts'
export type {
    DefineComponent,
    DefineSetupFnComponent,
    PublicProps
} from './apiDefineComponent.ts'
export type { InjectionKey } from './apiInject.ts'
export type {
    MultiWatchSources, WatchCallback, WatchEffect, WatchHandle, WatchOptions,
    WatchEffectOptions as WatchOptionsBase, WatchSource, WatchStopHandle
} from './apiWatch.ts'
export type {
    AllowedAttrs, AllowedComponentProps, Attrs, Component, ComponentCustomProps, ComponentInstance, ComponentInternalInstance, ConcreteComponent,
    FunctionalComponent, GlobalComponents,
    GlobalDirectives, SetupContext
} from './component.ts'
export type {
    EmitFn, EmitsOptions, EmitsToProps, ObjectEmitsOptions, ShortEmitsToObject
} from './componentEmits.ts'
export type {
    ComponentOptions, ComponentOptionsBase, RenderFunction
} from './componentOptions.ts'
export type {
    ComponentObjectPropsOptions, ComponentPropsOptions, ExtractDefaultPropTypes, ExtractPropTypes,
    ExtractPublicPropTypes, Prop,
    PropType
} from './componentProps.ts'
export type {
    ComponentCustomProperties, ComponentPublicInstance
} from './componentPublicInstance.ts'
export type {
    TransitionHooks, TransitionState
} from './components/BaseTransition.ts'
export type { SuspenseBoundary } from './components/Suspense.ts'
export type { Slot, Slots, SlotsType } from './componentSlots.ts'
export type {
    Directive, DirectiveArguments, DirectiveBinding,
    DirectiveHook, DirectiveModifiers, FunctionDirective, ObjectDirective
} from './directives.ts'
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
    capitalize, toDisplayString, toHandlerKey
} from '@arrange/vue-shared'
export {
    withCtx
} from './componentRenderContext.ts'
export { createSlots } from './helpers/createSlots.ts'
export { renderList } from './helpers/renderList.ts'
export { renderSlot } from './helpers/renderSlot.ts'
export { toHandlers } from './helpers/toHandlers.ts'
export { isMemoSame, withMemo } from './helpers/withMemo.ts'
export {
    createBlock, createCommentVNode, createElementBlock, createElementVNode, createStaticVNode, createTextVNode, guardReactiveProps, openBlock, setBlockTracking
} from './vnode.ts'

// For test-utils
export { transformVNodeArgs } from './vnode.ts'

export { getArrangeExecutionStats } from './executionStats.ts'
export { arrangeProps, arrangeValue } from './valueBinding.ts'
export { arrangeResource } from './resource.ts'

import { NOOP } from '@arrange/vue-shared'

export type { ValueExpression } from './valueBinding.ts'
