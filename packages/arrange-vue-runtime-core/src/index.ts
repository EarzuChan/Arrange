// Core API ------------------------------------------------------------------

export const version: string = __VERSION__
export {
  // core
  reactive,
  ref,
  readonly,
  // utilities
  unref,
  proxyRefs,
  isRef,
  toRef,
  toValue,
  toRefs,
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  // advanced
  customRef,
  triggerRef,
  shallowRef,
  shallowReactive,
  shallowReadonly,
  markRaw,
  toRaw,
  // effect
  effect,
  stop,
  getCurrentWatcher,
  onWatcherCleanup,
  ReactiveEffect,
  // effect scope
  effectScope,
  EffectScope,
  getCurrentScope,
  onScopeDispose,
} from '@arrange/vue-reactivity'
export { computed } from './apiComputed.ts'
export {
  watch,
  watchEffect,
  watchPostEffect,
  watchSyncEffect,
} from './apiWatch.ts'
export {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
  onRenderTracked,
  onRenderTriggered,
  onErrorCaptured,
  onServerPrefetch,
} from './apiLifecycle.ts'
export { provide, inject, hasInjectionContext } from './apiInject.ts'
export { nextTick } from './scheduler.ts'
export { defineComponent } from './apiDefineComponent.ts'
export { defineAsyncComponent } from './apiAsyncComponent.ts'
export { useAttrs, useSlots } from './apiSetupHelpers.ts'
export { useModel } from './helpers/useModel.ts'
export { useTemplateRef, type TemplateRef } from './helpers/useTemplateRef.ts'
export { useId } from './helpers/useId.ts'
export {
  hydrateOnIdle,
  hydrateOnVisible,
  hydrateOnMediaQuery,
  hydrateOnInteraction,
} from './hydrationStrategies.ts'

// <script setup> API ----------------------------------------------------------

export {
  // macros runtime, for typing and warnings only
  defineProps,
  defineEmits,
  defineExpose,
  defineOptions,
  defineSlots,
  defineModel,
  withDefaults,
  type DefineProps,
  type ModelRef,
  type ComponentTypeEmits,
} from './apiSetupHelpers.ts'

/**
 * @internal
 */
export {
  mergeDefaults,
  mergeModels,
  createPropsRestProxy,
  withAsyncContext,
} from './apiSetupHelpers.ts'

// Advanced API ----------------------------------------------------------------

// For getting a hold of the internal instance in setup() - useful for advanced
// plugins
export { getCurrentInstance } from './component.ts'

// For raw render function users
export { h } from './h.ts'
// Advanced render function utilities
export { createVNode, cloneVNode, mergeProps, isVNode } from './vnode.ts'
// VNode types
export { Fragment, Text, Comment, Static, type VNodeRef } from './vnode.ts'
// Built-in components
export { Teleport, type TeleportProps } from './components/Teleport.ts'
export { Suspense, type SuspenseProps } from './components/Suspense.ts'
export { KeepAlive, type KeepAliveProps } from './components/KeepAlive.ts'
export {
  BaseTransition,
  BaseTransitionPropsValidators,
  type BaseTransitionProps,
} from './components/BaseTransition.ts'
// For using custom directives
export { withDirectives } from './directives.ts'
// SSR context
export { useSSRContext, ssrContextKey } from './helpers/useSsrContext.ts'

// Custom Renderer API ---------------------------------------------------------

export { createRenderer, createHydrationRenderer } from './renderer.ts'
export { queuePostFlushCb } from './scheduler.ts'
import { warn as _warn } from './warning.ts'
export const warn = (__DEV__ ? _warn : NOOP) as typeof _warn

/** @internal */
export { assertNumber } from './warning.ts'
export {
  handleError,
  callWithErrorHandling,
  callWithAsyncErrorHandling,
  ErrorCodes,
} from './errorHandling.ts'
export {
  resolveComponent,
  resolveDirective,
  resolveDynamicComponent,
} from './helpers/resolveAssets.ts'
// For integration with runtime compiler
export { registerRuntimeCompiler, isRuntimeOnly } from './component.ts'
export {
  useTransitionState,
  resolveTransitionHooks,
  setTransitionHooks,
  getTransitionRawChildren,
} from './components/BaseTransition.ts'
export { initCustomFormatter } from './customFormatter.ts'

import { ErrorTypeStrings as _ErrorTypeStrings } from './errorHandling.ts'
/**
 * Runtime error messages. Only exposed in dev or esm builds.
 * @internal
 */
export const ErrorTypeStrings = (
  __ESM_BUNDLER__ || __CJS__ || __DEV__ ? _ErrorTypeStrings : null
) as typeof _ErrorTypeStrings

// For devtools
import {
  type DevtoolsHook,
  devtools as _devtools,
  setDevtoolsHook as _setDevtoolsHook,
} from './devtools.ts'

export const devtools = (
  __DEV__ || __ESM_BUNDLER__ ? _devtools : undefined
) as DevtoolsHook
export const setDevtoolsHook = (
  __DEV__ || __ESM_BUNDLER__ ? _setDevtoolsHook : NOOP
) as typeof _setDevtoolsHook

// Types -----------------------------------------------------------------------

import type { VNode } from './vnode.ts'
import type { ComponentInternalInstance } from './component.ts'

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
  Ref,
  MaybeRef,
  MaybeRefOrGetter,
  ToRef,
  ToRefs,
  UnwrapRef,
  ShallowRef,
  ShallowUnwrapRef,
  CustomRefFactory,
  ReactiveFlags,
  DeepReadonly,
  ShallowReactive,
  UnwrapNestedRefs,
  ComputedRef,
  WritableComputedRef,
  WritableComputedOptions,
  ComputedGetter,
  ComputedSetter,
  ReactiveEffectRunner,
  ReactiveEffectOptions,
  EffectScheduler,
  DebuggerOptions,
  DebuggerEvent,
  DebuggerEventExtraInfo,
  Raw,
  Reactive,
} from '@arrange/vue-reactivity'
export type {
  MultiWatchSources,
  WatchEffect,
  WatchOptions,
  WatchEffectOptions as WatchOptionsBase,
  WatchCallback,
  WatchSource,
  WatchHandle,
  WatchStopHandle,
} from './apiWatch.ts'
export type { InjectionKey } from './apiInject.ts'
export type {
  App,
  AppConfig,
  AppContext,
  Plugin,
  ObjectPlugin,
  FunctionPlugin,
  CreateAppFunction,
  OptionMergeFunction,
} from './apiCreateApp.ts'
export type {
  VNode,
  VNodeChild,
  VNodeTypes,
  VNodeProps,
  VNodeArrayChildren,
  VNodeNormalizedChildren,
} from './vnode.ts'
export type {
  Component,
  ConcreteComponent,
  FunctionalComponent,
  ComponentInternalInstance,
  Attrs,
  SetupContext,
  AllowedAttrs,
  ComponentCustomProps,
  AllowedComponentProps,
  GlobalComponents,
  GlobalDirectives,
  ComponentInstance,
  ComponentCustomElementInterface,
} from './component.ts'
export type {
  DefineComponent,
  DefineSetupFnComponent,
  PublicProps,
} from './apiDefineComponent.ts'
export type {
  ComponentOptions,
  ComponentOptionsMixin,
  ComponentCustomOptions,
  ComponentOptionsBase,
  ComponentProvideOptions,
  RenderFunction,
  MethodOptions,
  ComputedOptions,
  RuntimeCompilerOptions,
  ComponentInjectOptions,
  // deprecated
  ComponentOptionsWithoutProps,
  ComponentOptionsWithArrayProps,
  ComponentOptionsWithObjectProps,
} from './componentOptions.ts'
export type {
  EmitsOptions,
  ObjectEmitsOptions,
  EmitsToProps,
  ShortEmitsToObject,
  EmitFn,
} from './componentEmits.ts'
export type {
  ComponentPublicInstance,
  ComponentCustomProperties,
  CreateComponentPublicInstance,
  CreateComponentPublicInstanceWithMixins,
} from './componentPublicInstance.ts'
export type {
  Renderer,
  RendererNode,
  RendererElement,
  HydrationRenderer,
  RendererOptions,
  RootRenderFunction,
  ElementNamespace,
} from './renderer.ts'
export type { RootHydrateFunction } from './hydration.ts'
export type { Slot, Slots, SlotsType } from './componentSlots.ts'
export type {
  Prop,
  PropType,
  ComponentPropsOptions,
  ComponentObjectPropsOptions,
  ExtractPropTypes,
  ExtractPublicPropTypes,
  ExtractDefaultPropTypes,
} from './componentProps.ts'
export type {
  Directive,
  DirectiveBinding,
  DirectiveHook,
  ObjectDirective,
  FunctionDirective,
  DirectiveModifiers,
  DirectiveArguments,
} from './directives.ts'
export type { SuspenseBoundary } from './components/Suspense.ts'
export type {
  TransitionState,
  TransitionHooks,
} from './components/BaseTransition.ts'
export type {
  AsyncComponentOptions,
  AsyncComponentLoader,
} from './apiAsyncComponent.ts'
export type {
  HydrationStrategy,
  HydrationStrategyFactory,
} from './hydrationStrategies.ts'
export type { HMRRuntime } from './hmr.ts'

// Internal API ----------------------------------------------------------------

// **IMPORTANT** Internal APIs may change without notice between versions and
// user code should avoid relying on them.

// For compiler generated code
// should sync with '@arrange/vue-compiler-core/src/runtimeHelpers.ts'
export {
  withCtx,
  pushScopeId,
  popScopeId,
  withScopeId,
} from './componentRenderContext.ts'
export { renderList } from './helpers/renderList.ts'
export { toHandlers } from './helpers/toHandlers.ts'
export { renderSlot } from './helpers/renderSlot.ts'
export { createSlots } from './helpers/createSlots.ts'
export { withMemo, isMemoSame } from './helpers/withMemo.ts'
export {
  openBlock,
  createBlock,
  setBlockTracking,
  createTextVNode,
  createCommentVNode,
  createStaticVNode,
  createElementVNode,
  createElementBlock,
  guardReactiveProps,
} from './vnode.ts'
export {
  toDisplayString,
  camelize,
  capitalize,
  toHandlerKey,
  normalizeProps,
  normalizeClass,
  normalizeStyle,
} from '@arrange/vue-shared'

// For test-utils
export { transformVNodeArgs } from './vnode.ts'

// SSR -------------------------------------------------------------------------

// **IMPORTANT** These APIs are exposed solely for @vue/server-renderer and may
// change without notice between versions. User code should never rely on them.

import {
  createComponentInstance,
  getComponentPublicInstance,
  setupComponent,
} from './component.ts'
import { renderComponentRoot } from './componentRenderUtils.ts'
import { setCurrentRenderingInstance } from './componentRenderContext.ts'
import { isVNode, normalizeVNode } from './vnode.ts'
import { ensureValidVNode } from './helpers/renderSlot.ts'
import { popWarningContext, pushWarningContext } from './warning.ts'

const _ssrUtils: {
  createComponentInstance: typeof createComponentInstance
  setupComponent: typeof setupComponent
  renderComponentRoot: typeof renderComponentRoot
  setCurrentRenderingInstance: typeof setCurrentRenderingInstance
  isVNode: typeof isVNode
  normalizeVNode: typeof normalizeVNode
  getComponentPublicInstance: typeof getComponentPublicInstance
  ensureValidVNode: typeof ensureValidVNode
  pushWarningContext: typeof pushWarningContext
  popWarningContext: typeof popWarningContext
} = {
  createComponentInstance,
  setupComponent,
  renderComponentRoot,
  setCurrentRenderingInstance,
  isVNode,
  normalizeVNode,
  getComponentPublicInstance,
  ensureValidVNode,
  pushWarningContext,
  popWarningContext,
}

/**
 * SSR utils for \@vue/server-renderer. Only exposed in ssr-possible builds.
 * @internal
 */
export const ssrUtils = (__SSR__ ? _ssrUtils : null) as typeof _ssrUtils

// 2.x COMPAT ------------------------------------------------------------------

import { DeprecationTypes as _DeprecationTypes } from './compat/compatConfig.ts'
export type { CompatVue } from './compat/global.ts'
export type { LegacyConfig } from './compat/globalConfig.ts'

import { warnDeprecation } from './compat/compatConfig.ts'
import { createCompatVue } from './compat/global.ts'
import {
  checkCompatEnabled,
  isCompatEnabled,
  softAssertCompatEnabled,
} from './compat/compatConfig.ts'
import { resolveFilter as _resolveFilter } from './helpers/resolveAssets.ts'
import { NOOP } from '@arrange/vue-shared'

/**
 * @internal only exposed in compat builds
 */
export const resolveFilter: typeof _resolveFilter | null = __COMPAT__
  ? _resolveFilter
  : null

const _compatUtils: {
  warnDeprecation: typeof warnDeprecation
  createCompatVue: typeof createCompatVue
  isCompatEnabled: typeof isCompatEnabled
  checkCompatEnabled: typeof checkCompatEnabled
  softAssertCompatEnabled: typeof softAssertCompatEnabled
} = {
  warnDeprecation,
  createCompatVue,
  isCompatEnabled,
  checkCompatEnabled,
  softAssertCompatEnabled,
}

/**
 * @internal only exposed in compat builds.
 */
export const compatUtils = (
  __COMPAT__ ? _compatUtils : null
) as typeof _compatUtils

export const DeprecationTypes = (
  __COMPAT__ ? _DeprecationTypes : null
) as typeof _DeprecationTypes

