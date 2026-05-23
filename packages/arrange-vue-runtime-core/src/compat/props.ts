import { isArray } from '@arrange/vue-shared'
import { inject } from '../apiInject.ts'
import type { ComponentInternalInstance, Data } from '../component.ts'
import {
  type ComponentOptions,
  resolveMergedOptions,
} from '../componentOptions.ts'
import { DeprecationTypes, warnDeprecation } from './compatConfig.ts'

export function createPropsDefaultThis(
  instance: ComponentInternalInstance,
  rawProps: Data,
  propKey: string,
): object {
  return new Proxy(
    {},
    {
      get(_, key: string) {
        __DEV__ &&
          warnDeprecation(DeprecationTypes.PROPS_DEFAULT_THIS, null, propKey)
        // $options
        if (key === '$options') {
          return resolveMergedOptions(instance)
        }
        // props
        if (key in rawProps) {
          return rawProps[key]
        }
        // injections
        const injections = (instance.type as ComponentOptions).inject
        if (injections) {
          if (isArray(injections)) {
            if (injections.includes(key)) {
              return inject(key)
            }
          } else if (key in injections) {
            return inject(key)
          }
        }
      },
    },
  )
}

