export const packageJsonManagedItemKeys = {
    dependencies: "node.package-json.dependencies",
} as const

export type PackageJsonManagedItemKey = typeof packageJsonManagedItemKeys[keyof typeof packageJsonManagedItemKeys]
