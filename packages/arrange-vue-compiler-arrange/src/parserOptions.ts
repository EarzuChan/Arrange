import { Namespaces, type ParserOptions } from '@arrange/vue-compiler-core'

export const parserOptions: ParserOptions = {
    parseMode: 'base',
    isNativeTag: () => false,
    isVoidTag: () => false,
    isPreTag: () => false,
    isBuiltInArrangable: () => undefined,
    getNamespace: () => Namespaces.HTML,
}
