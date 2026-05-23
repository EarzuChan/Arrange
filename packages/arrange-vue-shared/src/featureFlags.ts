const g = globalThis as Record<string, unknown>

if (!("__DEV__" in g)) g.__DEV__ = process.env.NODE_ENV !== "production"
if (!("__TEST__" in g)) g.__TEST__ = false
if (!("__BROWSER__" in g)) g.__BROWSER__ = false
if (!("__SSR__" in g)) g.__SSR__ = false
if (!("__GLOBAL__" in g)) g.__GLOBAL__ = false
if (!("__CJS__" in g)) g.__CJS__ = false
if (!("__ESM_BROWSER__" in g)) g.__ESM_BROWSER__ = false
if (!("__ESM_BUNDLER__" in g)) g.__ESM_BUNDLER__ = true
if (!("__COMPAT__" in g)) g.__COMPAT__ = false
if (!("__FEATURE_OPTIONS_API__" in g)) g.__FEATURE_OPTIONS_API__ = false
if (!("__FEATURE_SUSPENSE__" in g)) g.__FEATURE_SUSPENSE__ = true
if (!("__FEATURE_PROD_DEVTOOLS__" in g)) g.__FEATURE_PROD_DEVTOOLS__ = false
if (!("__FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__" in g)) g.__FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__ = false
if (!("__VERSION__" in g)) g.__VERSION__ = "3.5.34-arrange"
