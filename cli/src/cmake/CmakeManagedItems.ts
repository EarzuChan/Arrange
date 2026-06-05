export const cmakeManagedItemKeys = {
    fetchContent: "cmake.fetch-content",
    pluginTarget: "cmake.plugin-target",
    linkFramework: "cmake.link-framework",
} as const

export type CmakeManagedItemKey = typeof cmakeManagedItemKeys[keyof typeof cmakeManagedItemKeys]
