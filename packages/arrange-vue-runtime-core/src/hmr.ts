/* eslint-disable no-restricted-globals */
import { extend, getGlobalThis } from '@arrange/vue-shared'
import {
    type ClassArrangable,
    type ArrangableInstance,
    type ArrangableOptions,
    type ConcreteArrangable,
    type InternalRenderFunction,
    isClassArrangable,
} from './arrangable.ts'
import { SchedulerJobFlags, queueJob, queuePostFlushCb } from './scheduler.ts'

type HMRArrangable = ArrangableOptions | ClassArrangable

export let isHmrUpdating = false

export const setHmrUpdating = (v: boolean): boolean => {
    try {
        return isHmrUpdating
    } finally {
        isHmrUpdating = v
    }
}

export const hmrDirtyArrangables: Map<
    ConcreteArrangable,
    Set<ArrangableInstance>
> = new Map<ConcreteArrangable, Set<ArrangableInstance>>()

export interface HMRRuntime {
    createRecord: typeof createRecord
    rerender: typeof rerender
    reload: typeof reload
}

// Expose the HMR runtime on the global object
// This makes it entirely tree-shakable without polluting the exports and makes
// it easier to be used in toolings like vue-loader
// Note: for a arrangable to be eligible for HMR it also needs the __hmrId option
// to be set so that its instances can be registered / removed.
if (__DEV__) {
    getGlobalThis().__VUE_HMR_RUNTIME__ = {
        createRecord: tryWrap(createRecord),
        rerender: tryWrap(rerender),
        reload: tryWrap(reload),
    } as HMRRuntime
}

const map: Map<
    string,
    {
        // the initial arrangable definition is recorded on import - this allows us
        // to apply hot updates to the arrangable even when there are no actively
        // rendered instance.
        initialDef: ArrangableOptions
        instances: Set<ArrangableInstance>
    }
> = new Map()

export function registerHMR(instance: ArrangableInstance): void {
    const id = instance.type.__hmrId!
    let record = map.get(id)
    if (!record) {
        createRecord(id, instance.type as HMRArrangable)
        record = map.get(id)!
    }
    record.instances.add(instance)
}

export function unregisterHMR(instance: ArrangableInstance): void {
    map.get(instance.type.__hmrId!)!.instances.delete(instance)
}

function createRecord(id: string, initialDef: HMRArrangable): boolean {
    if (map.has(id)) {
        return false
    }
    map.set(id, {
        initialDef: normalizeClassArrangable(initialDef),
        instances: new Set(),
    })
    return true
}

function normalizeClassArrangable(arrangable: HMRArrangable): ArrangableOptions {
    return isClassArrangable(arrangable) ? arrangable.__vccOpts : arrangable
}

function rerender(id: string, newRender?: Function): void {
    const record = map.get(id)
    if (!record) {
        return
    }

    // update initial record (for not-yet-rendered arrangable)
    record.initialDef.render = newRender

        // Create a snapshot which avoids the set being mutated during updates
        ;[...record.instances].forEach(instance => {
            if (newRender) {
                instance.render = newRender as InternalRenderFunction
                normalizeClassArrangable(instance.type as HMRArrangable).render = newRender
            }
            instance.renderCache = []
            // this flag forces child arrangables with slot content to update
            isHmrUpdating = true
            // #13771 don't update if the job is already disposed
            if (!(instance.job.flags! & SchedulerJobFlags.DISPOSED)) {
                instance.update()
            }
            isHmrUpdating = false
        })
}

function reload(id: string, newComp: HMRArrangable): void {
    const record = map.get(id)
    if (!record) return

    newComp = normalizeClassArrangable(newComp)
    // update initial def (for not-yet-rendered arrangables)
    updateArrangableDef(record.initialDef, newComp)

    // create a snapshot which avoids the set being mutated during updates
    const instances = [...record.instances]

    for (let i = 0; i < instances.length; i++) {
        const instance = instances[i]
        const oldComp = normalizeClassArrangable(instance.type as HMRArrangable)

        let dirtyInstances = hmrDirtyArrangables.get(oldComp)
        if (!dirtyInstances) {
            // 1. Update existing comp definition to match new one
            if (oldComp !== record.initialDef) {
                updateArrangableDef(oldComp, newComp)
            }
            // 2. mark definition dirty. This forces the renderer to replace the
            // arrangable on patch.
            hmrDirtyArrangables.set(oldComp, (dirtyInstances = new Set()))
        }
        dirtyInstances.add(instance)

        // 3. invalidate options resolution cache
        instance.appContext.propsCache.delete(instance.type as any)

        // 4. actually update
        if (instance.parent) {
            // 4. Force the parent instance to re-render. This will cause all updated
            // arrangables to be unmounted and re-mounted. Queue the update so that we
            // don't end up forcing the same parent to re-render multiple times.
            queueJob(() => {
                // vite-plugin-vue/issues/599
                // don't update if the job is already disposed
                if (!(instance.job.flags! & SchedulerJobFlags.DISPOSED)) {
                    isHmrUpdating = true
                    instance.parent!.update()
                    isHmrUpdating = false
                    // #6930, #11248 avoid infinite recursion
                    dirtyInstances.delete(instance)
                }
            })
        } else if (instance.appContext.reload) {
            // root instance mounted via createApp() has a reload method
            instance.appContext.reload()
        } else {
            console.warn(
                '[HMR] Root or manually mounted instance modified. Full reload required.',
            )
        }
    }

    // 5. make sure to cleanup dirty hmr arrangables after update
    queuePostFlushCb(() => {
        hmrDirtyArrangables.clear()
    })
}

function updateArrangableDef(
    oldComp: ArrangableOptions,
    newComp: ArrangableOptions,
) {
    extend(oldComp, newComp)
    for (const key in oldComp) {
        if (key !== '__file' && !(key in newComp)) {
            Reflect.deleteProperty(oldComp, key)
        }
    }
}

function tryWrap(fn: (id: string, arg: any) => any): Function {
    return (id: string, arg: any) => {
        try {
            return fn(id, arg)
        } catch (e: any) {
            console.error(e)
            console.warn(
                `[HMR] Something went wrong during Vue arrangable hot-reload. ` +
                `Full reload required.`,
            )
        }
    }
}
