import { isArray } from '@arrange/shared'
import { TrackOpTypes } from './constants.ts'
import { ARRAY_ITERATE_KEY, track } from './dep.ts'
import { endBatch, pauseTracking, resetTracking, startBatch } from './effect.ts'
import { isProxy, isReactive, isReadonly, isShallow, toRaw, toReactive, toReadonly } from './reactive.ts'

// 数组适配器调用宿主已实现的方法，不改变工程的最低编译目标
type NonMutatingArray = unknown[] & {
    toReversed(): unknown[]
    toSorted(comparer?: (a: unknown, b: unknown) => number): unknown[]
    toSpliced(...args: unknown[]): unknown[]
}

export function reactiveReadArray<T>(array: T[]): T[] {
    // 遍历只跟踪整组元素，深响应式数组才为读出的元素建立代理
    const raw = toRaw(array)
    if (raw === array) return raw
    track(raw, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
    return isShallow(array) ? raw : raw.map(toReactive)
}

export function shallowReadArray<T>(arr: T[]): T[] {
    track((arr = toRaw(arr)), TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
    return arr
}

function toWrapped(target: unknown, item: unknown) {
    if (isReadonly(target)) {
        return isReactive(target) ? toReadonly(toReactive(item)) : toReadonly(item)
    }
    return toReactive(item)
}

export const arrayInstrumentations: Record<string | symbol, Function> = <any>{
    __proto__: null,
    [Symbol.iterator]() {
        return iterator(this, Symbol.iterator, item => toWrapped(this, item))
    },
    concat(...args: unknown[]) {
        return reactiveReadArray(this).concat(...args.map(x => (isArray(x) ? reactiveReadArray(x) : x)))
    },
    entries() {
        return iterator(this, 'entries', (value: [number, unknown]) => {
            value[1] = toWrapped(this, value[1])
            return value
        })
    },
    every(fn: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
        return apply(this, 'every', fn, thisArg, undefined, arguments)
    },
    filter(fn: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
        return apply(this, 'filter', fn, thisArg, v => v.map((item: unknown) => toWrapped(this, item)), arguments)
    },
    find(fn: (item: unknown, index: number, array: unknown[]) => boolean, thisArg?: unknown) {
        return apply(this, 'find', fn, thisArg, item => toWrapped(this, item), arguments)
    },
    findIndex(fn: (item: unknown, index: number, array: unknown[]) => boolean, thisArg?: unknown) {
        return apply(this, 'findIndex', fn, thisArg, undefined, arguments)
    },
    findLast(fn: (item: unknown, index: number, array: unknown[]) => boolean, thisArg?: unknown) {
        return apply(this, 'findLast', fn, thisArg, item => toWrapped(this, item), arguments)
    },
    findLastIndex(fn: (item: unknown, index: number, array: unknown[]) => boolean, thisArg?: unknown) {
        return apply(this, 'findLastIndex', fn, thisArg, undefined, arguments)
    },

    forEach(fn: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
        return apply(this, 'forEach', fn, thisArg, undefined, arguments)
    },
    includes(...args: unknown[]) {
        return searchProxy(this, 'includes', args)
    },
    indexOf(...args: unknown[]) {
        return searchProxy(this, 'indexOf', args)
    },
    join(separator?: string) {
        return reactiveReadArray(this).join(separator)
    },

    lastIndexOf(...args: unknown[]) {
        return searchProxy(this, 'lastIndexOf', args)
    },
    map(fn: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
        return apply(this, 'map', fn, thisArg, undefined, arguments)
    },
    pop() {
        return noTracking(this, 'pop')
    },
    push(...args: unknown[]) {
        return noTracking(this, 'push', args)
    },
    reduce(fn: (acc: unknown, item: unknown, index: number, array: unknown[]) => unknown, ...args: unknown[]) {
        return reduce(this, 'reduce', fn, args)
    },
    reduceRight(fn: (acc: unknown, item: unknown, index: number, array: unknown[]) => unknown, ...args: unknown[]) {
        return reduce(this, 'reduceRight', fn, args)
    },
    shift() {
        return noTracking(this, 'shift')
    },

    some(fn: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
        return apply(this, 'some', fn, thisArg, undefined, arguments)
    },
    splice(...args: unknown[]) {
        return noTracking(this, 'splice', args)
    },
    toReversed() {
        return (reactiveReadArray(this) as NonMutatingArray).toReversed()
    },
    toSorted(comparer?: (a: unknown, b: unknown) => number) {
        return (reactiveReadArray(this) as NonMutatingArray).toSorted(comparer)
    },
    toSpliced(...args: unknown[]) {
        return (reactiveReadArray(this) as NonMutatingArray).toSpliced(...args)
    },
    unshift(...args: unknown[]) {
        return noTracking(this, 'unshift', args)
    },
    values() {
        return iterator(this, 'values', item => toWrapped(this, item))
    },
}

function iterator(self: unknown[], method: keyof Array<unknown>, wrapValue: (value: any) => unknown) {
    const arr = shallowReadArray(self)
    const iter = (arr[method] as any)() as IterableIterator<unknown> & {
        _next: IterableIterator<unknown>['next']
    }
    if (arr !== self && !isShallow(self)) {
        iter._next = iter.next
        iter.next = () => {
            const result = iter._next()
            if (!result.done) {
                result.value = wrapValue(result.value)
            }
            return result
        }
    }
    return iter
}

type ArrayMethods = 'every' | 'filter' | 'find' | 'findIndex' | 'findLast' | 'findLastIndex' | 'forEach' | 'map' | 'some'

const arrayProto = Array.prototype as unknown as Record<ArrayMethods, Function>
function apply(self: unknown[], method: ArrayMethods, fn: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown, wrappedRetFn?: (result: any) => unknown, args?: IArguments) {
    const arr = shallowReadArray(self) as unknown[] & Record<ArrayMethods, Function>
    const needsWrap = arr !== self && !isShallow(self)
    const methodFn = arr[method]

    // 用户覆盖的方法仍以代理为接收者，并保持返回值的响应式转换
    if (methodFn !== arrayProto[method]) {
        const result = methodFn.apply(self, args)
        return needsWrap ? toReactive(result) : result
    }

    let wrappedFn = fn
    if (arr !== self) {
        if (needsWrap) {
            wrappedFn = function(this: unknown, item, index) {
                return fn.call(this, toWrapped(self, item), index, self)
            }
        } else if (fn.length > 2) {
            wrappedFn = function(this: unknown, item, index) {
                return fn.call(this, item, index, self)
            }
        }
    }
    const result = methodFn.call(arr, wrappedFn, thisArg)
    return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result
}

function reduce(self: unknown[], method: keyof Array<any>, fn: (acc: unknown, item: unknown, index: number, array: unknown[]) => unknown, args: unknown[]) {
    const arr = shallowReadArray(self)
    const needsWrap = arr !== self && !isShallow(self)
    let wrappedFn = fn
    let wrapInitialAccumulator = false
    if (arr !== self) {
        if (needsWrap) {
            wrapInitialAccumulator = args.length === 0
            wrappedFn = function(this: unknown, acc, item, index) {
                if (wrapInitialAccumulator) {
                    wrapInitialAccumulator = false
                    acc = toWrapped(self, acc)
                }
                return fn.call(this, acc, toWrapped(self, item), index, self)
            }
        } else if (fn.length > 3) {
            wrappedFn = function(this: unknown, acc, item, index) {
                return fn.call(this, acc, item, index, self)
            }
        }
    }
    const result = (arr[method] as any)(wrappedFn, ...args)
    return wrapInitialAccumulator ? toWrapped(self, result) : result
}

function searchProxy(self: unknown[], method: keyof Array<any>, args: unknown[]) {
    const arr = toRaw(self) as any
    track(arr, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
    const res = arr[method](...args)

    if ((res === -1 || res === false) && isProxy(args[0])) {
        args[0] = toRaw(args[0])
        return arr[method](...args)
    }

    return res
}

function noTracking(
    self: unknown[],
    method: keyof Array<any>,
    args: unknown[] = [],
) {
    // 变更方法在批次内暂停收集，避免数组长度读写形成递归依赖
    pauseTracking()
    startBatch()
    const res = (toRaw(self) as any)[method].apply(self, args)
    endBatch()
    resetTracking()
    return res
}
