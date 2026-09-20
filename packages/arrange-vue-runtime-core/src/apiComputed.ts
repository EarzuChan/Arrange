import { type ComputedRefImpl, computed as _computed } from '@arrange/vue-reactivity'
import { getCurrentInstance } from './arrangable.ts'

export const computed: typeof _computed = (
    getterOrOptions: any,
    debugOptions?: any,
) => {
    const c = _computed(getterOrOptions, debugOptions)
    if (__DEV__) {
        const i = getCurrentInstance()
        if (i && i.appContext.config.warnRecursiveComputed) {
            ; (c as unknown as ComputedRefImpl<any>)._warnRecursive = true
        }
    }
    return c as any
}
