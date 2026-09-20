import {
    type ArrangableInstance,
    getCurrentInstance,
} from '../arrangable.ts'
import { warn } from '../warning.ts'

export function useId(): string {
    const i = getCurrentInstance()
    if (i) {
        return (i.appContext.config.idPrefix || 'v') + '-' + i.ids[0] + i.ids[1]++
    } else if (__DEV__) {
        warn(
            `useId() is called when there is no active arrangable ` +
            `instance to be associated with.`,
        )
    }
    return ''
}

/**
 * There are 3 types of async boundaries:
 * - async arrangables
 * - arrangables with async setup()
 */
export function markAsyncBoundary(instance: ArrangableInstance): void {
    instance.ids = [instance.ids[0] + instance.ids[2]++ + '-', 0, 0]
}
