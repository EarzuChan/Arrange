export const nodeManagedItemKeys = {
    packageJsonFrameworkDependency: "node.package-json.framework-dependency",
    npmrcArrangeRegistry: "node.npmrc.arrange-registry",
} as const

export type NodeManagedItemKey = typeof nodeManagedItemKeys[keyof typeof nodeManagedItemKeys]
