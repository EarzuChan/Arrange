import { Namespaces, type ParserOptions } from '../core/index.ts'

export const parserOptions: ParserOptions = {
    parseMode: 'base',
    isVoidTag: () => false,
    isPreTag: () => false,
    getNamespace: () => Namespaces.HTML,
}
