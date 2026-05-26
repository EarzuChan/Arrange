export const ARRANGE_VUE_VERSION = "3.5.34-arrange"

export const DEV_BUNDLE_PATH = "/@arrange/app.js"
export const PUBLIC_PLUGIN_NAME = "arrange-framework"
export const DEV_BUNDLE_PLUGIN_NAME = "arrange-framework:dev-bundle"

export const ARRANGE_VUE_DEFINE_KEYS = [
    "__DEV__",
    "__TEST__",
    "__BROWSER__",
    "__SSR__",
    "__GLOBAL__",
    "__CJS__",
    "__ESM_BROWSER__",
    "__ESM_BUNDLER__",
    "__COMPAT__",
    "__FEATURE_OPTIONS_API__",
    "__FEATURE_SUSPENSE__",
    "__FEATURE_PROD_DEVTOOLS__",
    "__FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__",
    "__VERSION__",
] as const

export const ARRANGE_VUE_DEFINES = {
    __DEV__: "false",
    __TEST__: "false",
    __BROWSER__: "false",
    __SSR__: "false",
    __GLOBAL__: "false",
    __CJS__: "false",
    __ESM_BROWSER__: "false",
    __ESM_BUNDLER__: "true",
    __COMPAT__: "false",
    __FEATURE_OPTIONS_API__: "false",
    __FEATURE_SUSPENSE__: "true",
    __FEATURE_PROD_DEVTOOLS__: "false",
    __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    __VERSION__: JSON.stringify(ARRANGE_VUE_VERSION),
} as const satisfies Record<(typeof ARRANGE_VUE_DEFINE_KEYS)[number], string>

export const ARRANGE_VUE_MACRO_PATTERN = new RegExp(
    `\\b__(?:${ARRANGE_VUE_DEFINE_KEYS.map((key) => key.slice(2, -2)).join("|")})__\\b`,
)
