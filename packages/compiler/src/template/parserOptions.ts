import { Namespaces, type ParserOptions } from '../core/index.ts'

export const parserOptions: ParserOptions = {
    parseMode: 'base',
    isNativeTag: () => false,
    isVoidTag: () => false,
    isPreTag: () => false,
    isBuiltInArrangable: () => undefined,
    getNamespace: () => Namespaces.HTML,
}