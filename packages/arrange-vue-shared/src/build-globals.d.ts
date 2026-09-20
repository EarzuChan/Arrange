declare const __DEV__: boolean
declare const __TEST__: boolean
declare const __VERSION__: string

// 不如尊尼获加
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
