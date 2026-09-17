import {Namespaces, type ParserOptions} from '@arrange/vue-compiler-core'

const nativeTags = new Set(['Box', 'Row', 'Column', 'Spacer', 'Text', 'Input', 'Image', 'Canvas'])

export const parserOptions: ParserOptions = {
    parseMode: 'base',
    isNativeTag: tag => nativeTags.has(tag),
    isVoidTag: () => false,
    isPreTag: () => false,
    isBuiltInComponent: () => undefined,
    getNamespace: () => Namespaces.HTML,
}
