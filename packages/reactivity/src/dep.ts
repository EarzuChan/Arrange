import { extend, isArray, isIntegerKey, isMap, isSymbol } from '@arrange/shared'
import type { ComputedRefImpl } from './computed.ts'
import { ReactiveFlags, type TrackOpTypes, TriggerOpTypes } from './constants.ts'
import { type DebuggerEventExtraInfo, EffectFlags, ReactiveEffect, type Subscriber, activeSub, endBatch, shouldTrack, startBatch } from './effect.ts'

// 任意依赖触发都会推进版本，计算值可据此跳过无变化时的检查
export let globalVersion = 0

// 同一订阅同时挂在依赖与订阅者两条链上，便于独立退订和复用
export class Link {
    version: number

    nextDep?: Link
    prevDep?: Link
    nextSub?: Link
    prevSub?: Link
    prevActiveLink?: Link

    constructor(public sub: Subscriber, public dep: Dep) {
        this.version = dep.version
        this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = undefined
    }
}

export class Dep {
    version = 0
    activeLink?: Link = undefined

    subs?: Link = undefined

    subsHead?: Link

    map?: KeyToDepMap = undefined
    key?: unknown = undefined

    sc: number = 0

    readonly [ReactiveFlags.SKIP] = true

    constructor(public computed?: ComputedRefImpl | undefined) {
        if (__DEV__) {
            this.subsHead = undefined
        }
    }

    track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
        if (!activeSub || !shouldTrack || activeSub === this.computed || activeSub instanceof ReactiveEffect && !(activeSub.flags & EffectFlags.ACTIVE)) {
            return
        }

        let link = this.activeLink
        if (link === undefined || link.sub !== activeSub) {
            link = this.activeLink = new Link(activeSub, this)

            if (!activeSub.deps) {
                activeSub.deps = activeSub.depsTail = link
            } else {
                link.prevDep = activeSub.depsTail
                activeSub.depsTail!.nextDep = link
                activeSub.depsTail = link
            }

            addSub(link)
        } else if (link.version === -1) {
            // 本轮重新读取的旧依赖恢复版本，并移到本轮访问顺序的末尾
            link.version = this.version

            if (link.nextDep) {
                const next = link.nextDep
                next.prevDep = link.prevDep
                if (link.prevDep) {
                    link.prevDep.nextDep = next
                }

                link.prevDep = activeSub.depsTail
                link.nextDep = undefined
                activeSub.depsTail!.nextDep = link
                activeSub.depsTail = link

                if (activeSub.deps === link) {
                    activeSub.deps = next
                }
            }
        }

        if (__DEV__ && activeSub.onTrack) {
            activeSub.onTrack(
                extend(
                    {
                        effect: activeSub,
                    },
                    debugInfo,
                ),
            )
        }

        return link
    }

    trigger(debugInfo?: DebuggerEventExtraInfo): void {
        this.version++
        globalVersion++
        this.notify(debugInfo)
    }

    notify(debugInfo?: DebuggerEventExtraInfo): void {
        startBatch()
        try {
            if (__DEV__) {
                for (let head = this.subsHead; head; head = head.nextSub) {
                    if (head.sub.onTrigger && !(head.sub.flags & EffectFlags.NOTIFIED)) {
                        head.sub.onTrigger(
                            extend(
                                {
                                    effect: head.sub,
                                },
                                debugInfo,
                            ),
                        )
                    }
                }
            }
            for (let link = this.subs; link; link = link.prevSub) {
                if (link.sub.notify()) {

                    (link.sub as ComputedRefImpl).dep.notify()
                }
            }
        } finally {
            endBatch()
        }
    }
}

function addSub(link: Link) {
    link.dep.sc++
    if (link.sub.flags & EffectFlags.TRACKING) {
        const computed = link.dep.computed
        if (computed && !link.dep.subs) {
            computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
            for (let l = computed.deps; l; l = l.nextDep) {
                addSub(l)
            }
        }

        const currentTail = link.dep.subs
        if (currentTail !== link) {
            link.prevSub = currentTail
            if (currentTail) currentTail.nextSub = link
        }

        if (__DEV__ && link.dep.subsHead === undefined) {
            link.dep.subsHead = link
        }

        link.dep.subs = link
    }
}

type KeyToDepMap = Map<any, Dep>

export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()

export const ITERATE_KEY: unique symbol = Symbol(__DEV__ ? 'Object iterate' : '')
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol(__DEV__ ? 'Map keys iterate' : '')
export const ARRAY_ITERATE_KEY: unique symbol = Symbol(__DEV__ ? 'Array iterate' : '')

export function track(target: object, type: TrackOpTypes, key: unknown): void {
    if (shouldTrack && activeSub) {
        let depsMap = targetMap.get(target)
        if (!depsMap) {
            targetMap.set(target, (depsMap = new Map()))
        }
        let dep = depsMap.get(key)
        if (!dep) {
            depsMap.set(key, (dep = new Dep()))
            dep.map = depsMap
            dep.key = key
        }
        if (__DEV__) {
            dep.track({
                target,
                type,
                key,
            })
        } else {
            dep.track()
        }
    }
}

export function trigger(target: object, type: TriggerOpTypes, key?: unknown, newValue?: unknown, oldValue?: unknown, oldTarget?: Map<unknown, unknown> | Set<unknown>): void {
    const depsMap = targetMap.get(target)
    if (!depsMap) {
        globalVersion++
        return
    }

    const run = (dep: Dep | undefined) => {
        if (dep) {
            if (__DEV__) {
                dep.trigger({
                    target,
                    type,
                    key,
                    newValue,
                    oldValue,
                    oldTarget,
                })
            } else {
                dep.trigger()
            }
        }
    }

    startBatch()

    if (type === TriggerOpTypes.CLEAR) {
        depsMap.forEach(run)
    } else {
        const targetIsArray = isArray(target)
        const isArrayIndex = targetIsArray && isIntegerKey(key)

        if (targetIsArray && key === 'length') {
            const newLength = Number(newValue)
            depsMap.forEach((dep, key) => {
                if (
                    key === 'length' || key === ARRAY_ITERATE_KEY || (!isSymbol(key) && key >= newLength)
                ) {
                    run(dep)
                }
            })
        } else {
            if (key !== void 0 || depsMap.has(void 0)) {
                run(depsMap.get(key))
            }

            if (isArrayIndex) {
                run(depsMap.get(ARRAY_ITERATE_KEY))
            }

            switch (type) {
                case TriggerOpTypes.ADD:
                    if (!targetIsArray) {
                        run(depsMap.get(ITERATE_KEY))
                        if (isMap(target)) {
                            run(depsMap.get(MAP_KEY_ITERATE_KEY))
                        }
                    } else if (isArrayIndex) {
                        run(depsMap.get('length'))
                    }
                    break
                case TriggerOpTypes.DELETE:
                    if (!targetIsArray) {
                        run(depsMap.get(ITERATE_KEY))
                        if (isMap(target)) {
                            run(depsMap.get(MAP_KEY_ITERATE_KEY))
                        }
                    }
                    break
                case TriggerOpTypes.SET:
                    if (isMap(target)) {
                        run(depsMap.get(ITERATE_KEY))
                    }
                    break
            }
        }
    }

    endBatch()
}

export function getDepFromReactive(object: any, key: string | number | symbol): Dep | undefined {
    const depMap = targetMap.get(object)
    return depMap && depMap.get(key)
}
