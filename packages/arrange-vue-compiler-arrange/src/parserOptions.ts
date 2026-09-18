import { Namespaces, type ParserOptions } from '@arrange/vue-compiler-core'
import { isHostTag } from '@arrange/vue-shared'

export const parserOptions: ParserOptions = {
    parseMode: 'base',
    isNativeTag: tag => tag !== 'Icon' && isHostTag(tag),
    isVoidTag: () => false,
    isPreTag: () => false,
    isBuiltInComponent: () => undefined,
    getNamespace: () => Namespaces.HTML,
}
