import type { Node } from '@babel/types'
import { isCallOf } from './utils.ts'
import type { ScriptCompileContext } from './context.ts'

export const DEFINE_EXPOSE = 'defineExpose'

export function processDefineExpose(
  ctx: ScriptCompileContext,
  node: Node,
): boolean {
  if (isCallOf(node, DEFINE_EXPOSE)) {
    if (ctx.hasDefineExposeCall) {
      ctx.error(`duplicate ${DEFINE_EXPOSE}() call`, node)
    }
    ctx.hasDefineExposeCall = true
    return true
  }
  return false
}
