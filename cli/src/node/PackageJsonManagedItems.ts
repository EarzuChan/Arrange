export const packageJsonManagedItemKeys = {
    dependencies: "node.package-json.dependencies",
    scripts: "node.package-json.scripts",
    devDependencies: "node.package-json.dev-dependencies",
} as const

export type PackageJsonManagedItemKey = typeof packageJsonManagedItemKeys[keyof typeof packageJsonManagedItemKeys]
