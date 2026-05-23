import { ShapeFlags } from '@arrange/vue-shared'
import type { ComponentInternalInstance } from '../component.ts'
import type { ComponentPublicInstance } from '../componentPublicInstance.ts'
import type { VNode } from '../vnode.ts'
import { DeprecationTypes, assertCompatEnabled } from './compatConfig.ts'

export function getCompatChildren(
  instance: ComponentInternalInstance,
): ComponentPublicInstance[] {
  assertCompatEnabled(DeprecationTypes.INSTANCE_CHILDREN, instance)
  const root = instance.subTree
  const children: ComponentPublicInstance[] = []
  if (root) {
    walk(root, children)
  }
  return children
}

function walk(vnode: VNode, children: ComponentPublicInstance[]) {
  if (vnode.component) {
    children.push(vnode.component.proxy!)
  } else if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    const vnodes = vnode.children as VNode[]
    for (let i = 0; i < vnodes.length; i++) {
      walk(vnodes[i], children)
    }
  }
}

