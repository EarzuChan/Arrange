declare const __DEV__: boolean
declare const __TEST__: boolean
declare const __BROWSER__: boolean
declare const __SSR__: boolean
declare const __GLOBAL__: boolean
declare const __CJS__: boolean
declare const __ESM_BROWSER__: boolean
declare const __ESM_BUNDLER__: boolean
declare const __COMPAT__: boolean
declare const __FEATURE_OPTIONS_API__: boolean
declare const __FEATURE_SUSPENSE__: boolean
declare const __FEATURE_PROD_DEVTOOLS__: boolean
declare const __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__: boolean
declare const __VERSION__: string

declare module "estree-walker" {
    export type WalkerContext = {
        skip: () => void
        remove: () => void
        replace: (node: unknown) => void
    }

    export type WalkerCallback = (this: WalkerContext, node: any, parent: any, prop: any, index: any) => void

    export function walk(ast: unknown, options: {
        enter?: WalkerCallback
        leave?: WalkerCallback
        exit?: WalkerCallback
    }): unknown
}

declare module "hash-sum" {
    export default function hash(input: unknown): string
}

declare module "merge-source-map" {
    const mergeSourceMap: any
    export default mergeSourceMap
}
