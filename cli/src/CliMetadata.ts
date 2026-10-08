import pkg from "../package.json" with {type: "json"}

export const cliName = "arrange"
export const cliVersion = pkg.version
export const cliCompatibility = pkg.compatibility
export const cliDescription = pkg.description
export const supportedCliPlatforms = ["darwin", "win32"] as const
export const frameworkRegistryTimeoutMs = 15000

export const defaultFetchUrl = "https://github.com/EarzuChan/Arrange.git"
export const defaultNodeRegistryUrl = "https://registry.npmjs.org"
export const frameworkPackageName = "@arrange/framework"
export const minimumNodeMajor = 24
export const minimumCmakeVersion = "3.24.0"
export const defaultDevServerUrl = "http://127.0.0.1:9178"
export const defaultUiOutputDirectory = "dist"
export const localWorkDirectory = ".arrange"
export const uiToolchainVersions = { vite: pkg.dependencies.vite, tsx: pkg.devDependencies.tsx, typescript: pkg.devDependencies.typescript, nodeTypes: pkg.devDependencies["@types/node"] } as const
export const defaultProjectDirectories = { ui: "ui", native: "native", artifacts: "artifacts" } as const
export const productTargetSuffixes = { standalone: "Standalone", vst3: "VST3" } as const
export const defaultNativeGenerator = "Ninja"
export const defaultBundleIdPrefix = "com.arrange"
export const processStopGraceMs = 2000
export const toolProbeTimeoutMs = 15000
export const devReadinessTimeoutMs = 30000
export const nativeBuildDirectoryName = "build"
export const cmakeQueryClientName = "arrange"
export const cmakePreparationFileName = "preparation.json"
export const uiPreparationFileName = "ui-preparation.json"
export const defaultDevReadinessPath = "/@arrange/modules"
