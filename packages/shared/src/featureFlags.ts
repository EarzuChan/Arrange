const g = globalThis as Record<string, unknown>

if (!("__DEV__" in g)) g.__DEV__ = process.env.NODE_ENV !== "production"
if (!("__TEST__" in g)) g.__TEST__ = false
if (!("__VERSION__" in g)) g.__VERSION__ = "3.5.34-arrange"