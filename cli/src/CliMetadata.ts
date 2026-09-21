import pkg from "../package.json" with {type: "json"}

export const cliName = "Arrange"
export const cliVersion = pkg.version
export const cliCompatibility = pkg.compatibility
export const cliDescription = pkg.description

// 其余金典常量

export const defaultFetchUrl = "https://github.com/EarzuChan/Arrange.git"
export const defaultNodeRegistryUrl = "https://registry.npmjs.org"
export const frameworkPackageName = "@arrange/framework"