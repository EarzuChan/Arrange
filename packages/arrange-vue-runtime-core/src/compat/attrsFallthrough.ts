import { isOn } from '@arrange/vue-shared'
import type { ComponentInternalInstance } from '../component.ts'
import { DeprecationTypes, isCompatEnabled } from './compatConfig.ts'

export function shouldSkipAttr(
  key: string,
  instance: ComponentInternalInstance,
): boolean {
  if (key === 'is') {
    return true
  }
  if (
    (key === 'class' || key === 'style') &&
    isCompatEnabled(DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE, instance)
  ) {
    return true
  }
  if (
    isOn(key) &&
    isCompatEnabled(DeprecationTypes.INSTANCE_LISTENERS, instance)
  ) {
    return true
  }
  // vue-router
  if (key.startsWith('routerView') || key === 'registerRouteInstance') {
    return true
  }
  return false
}

