import { currentInstance } from './runtime/arrangable.ts'
import { getCurrentScope, onScopeDispose } from '@arrange/reactivity'
import type { NativeTransactionTarget } from './native.ts'
import type { InjectionKey } from './runtime/apiInject.ts'

export type FocusDirection = 'next' | 'previous' | 'up' | 'down' | 'left' | 'right'
export type FocusState = Readonly<{ isFocused: boolean; hasFocus: boolean }>
export type FocusProperties = Readonly<Partial<Record<FocusDirection, FocusRequester>> & { canFocus?: boolean }>
export interface FocusRequester { requestFocus(): boolean }
export interface FocusManager { clearFocus(): void; moveFocus(direction: FocusDirection): boolean }

export const FocusManagerKey: InjectionKey<FocusManager> = Symbol('Arrange.FocusManager')

let nextIdentity = 1
const requesters = new WeakMap<FocusRequester, number>()
function currentNative(): NativeTransactionTarget | undefined {
    return (currentInstance?.appContext.host as { native?: NativeTransactionTarget } | undefined)?.native ?? globalThis.__ARRANGE_NATIVE__
}
export function focusRequesterIdentity(requester: FocusRequester): number {
    const identity = requesters.get(requester)
    if (!identity) throw new TypeError('需要 createFocusRequester 创建的焦点请求器')
    return identity
}
export function createFocusRequester(): FocusRequester {
    const identity = nextIdentity++
    if (identity > 0xffffffff) throw new RangeError('焦点请求器身份已耗尽')
    const captured = currentNative()
    let alive = true
    const requester = Object.freeze({
        requestFocus(): boolean {
            if (!alive) return false
            return (captured ?? currentNative())?.focusCommand?.('request', identity) ?? false
        }
    })
    requesters.set(requester, identity)
    if (getCurrentScope()) onScopeDispose(() => {
        alive = false;
        (captured ?? currentNative())?.focusCommand?.('cancel', identity)
    })
    return requester
}
export function createNativeFocusManager(native: NativeTransactionTarget): { manager: FocusManager; dispose(): void } {
    let alive = true
    const manager: FocusManager = Object.freeze({
        clearFocus() { if (alive) native.focusCommand?.('clear', 0) },
        moveFocus(direction: FocusDirection) {
            if (!['next', 'previous', 'up', 'down', 'left', 'right'].includes(direction)) throw new TypeError('焦点方向无效')
            return alive && (native.focusCommand?.('move', 0, direction) ?? false)
        },
    })
    return { manager, dispose() { alive = false } }
}
