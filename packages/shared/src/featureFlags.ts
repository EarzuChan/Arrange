export { }

declare global {
    const __DEV__: boolean
    const __TEST__: boolean
}

const g = globalThis as Record<string, unknown>

if (!("__DEV__" in g)) g.__DEV__ = process.env.NODE_ENV !== "production"
if (!("__TEST__" in g)) g.__TEST__ = false
