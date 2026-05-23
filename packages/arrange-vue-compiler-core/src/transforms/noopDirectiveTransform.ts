import type { DirectiveTransform } from '../transform.ts'

export const noopDirectiveTransform: DirectiveTransform = () => ({ props: [] })
