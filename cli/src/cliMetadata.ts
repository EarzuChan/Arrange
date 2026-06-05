import pkg from "../package.json" with {type: "json"}

export const cliName = "Arrange"
export const cliVersion = pkg.version
export const cliCompatibility = pkg.compatibility
export const cliDescription = pkg.description
