export const ARRANGE_VERSION = "3.5.34-arrange"

export const DEV_BUNDLE_PATH = "/@arrange/app.js"

export const PUBLIC_PLUGIN_NAME = "arrange-framework"

export const DEV_BUNDLE_PLUGIN_NAME = "arrange-framework:dev-bundle"

export const ARRANGE_DEFINE_KEYS = ["__DEV__", "__TEST__", "__VERSION__",] as const

export const ARRANGE_DEFINES = { __DEV__: "false", __TEST__: "false", __VERSION__: JSON.stringify(ARRANGE_VERSION) } as const satisfies Record<(typeof ARRANGE_DEFINE_KEYS)[number], string>

export const ARRANGE_MACRO_PATTERN = new RegExp(`\\b__(?:${ARRANGE_DEFINE_KEYS.map((key) => key.slice(2, -2)).join("|")})__\\b`)