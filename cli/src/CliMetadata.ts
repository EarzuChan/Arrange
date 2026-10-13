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
export const defaultProjectIconPath = "assets/icon.png"
export const nativeIconCmakeDefinitions = { ico: "ARRANGE_CLI_ICON_ICO", icns: "ARRANGE_CLI_ICON_ICNS", presentation: "ARRANGE_CLI_PRESENTATION_SIGNATURE" } as const
export const nativeIconDirectory = "generated/icon"
export const nativeBundleIconName = "ArrangeIcon.icns"
export const nativeWindowsIconOwnershipFile = ".arrange-icon"
export const productTargetSuffixes = { standalone: "Standalone", vst3: "VST3" } as const
export const defaultNativeGenerator = "Ninja"
export const defaultBundleIdPrefix = "com"
export const processStopGraceMs = 2000
export const toolProbeTimeoutMs = 15000
export const frameworkSourceProbeTimeoutMs = 30000
export const devReadinessTimeoutMs = 30000
// Windows 的 cl、link、rc 不声明长路径支持（即使系统已启用 LongPathsEnabled），完整路径超过 259 字符就无法打开文件
// 因此 Windows 构建树放在短的哈希目录下。尾部预算是构建树内最长的相对路径加余量，按 JUCE 源码布局区分：
// FetchContent 把 JUCE 取到构建树内时，对象路径为 …\arrange_juce.dir\__\__\__\juce-src\modules\…，实测最长 173
// 使用外部 JUCE 源码（JUCE_DIR、FETCHCONTENT_SOURCE_DIR_JUCE）时，CMake 把源码绝对路径内嵌进对象路径，实测最长 193
export const windowsMaxPathLength = 259
export const windowsBuildPathTailBudget = 180
export const windowsExternalSourceTailBudget = 200
export const buildOwnerFileName = "owner.json"
export const cmakeQueryClientName = "arrange"
export const cmakePreparationFileName = "preparation.json"
export const cmakeDefinitionsFileName = "definitions.json"
export const reservedCmakeDefinitions = [...Object.values(nativeIconCmakeDefinitions), "CMAKE_BUILD_TYPE", "CMAKE_GENERATOR", "CMAKE_GENERATOR_PLATFORM", "CMAKE_MAKE_PROGRAM", "CMAKE_C_COMPILER", "CMAKE_CXX_COMPILER", "CMAKE_OSX_ARCHITECTURES"] as const
export const userDirectoryName = ".arrange"
export const userDirectoryEnvironment = "ARRANGE_HOME"
export const projectRegistrySchema = 2
export const transactionSchema = 1
export const sourceReferencesFileName = "source-references.json"
export const sourceReferencesSchema = 1
export const nativeVerificationFileName = "arrange-native-verification.json"
export const nativeVerificationSchema = 1
export const sourceCacheSchema = 2
export const sourceLocalTimeoutMs = 600000
export const nativeDependencyManifest = "cmake/NativeDependencies.json"
export const windowsObjectPathMax = 200
export const operationPollMs = 100
export const operationWaitMs = 600000
export const operationProtocolVersion = 1
export const uiPreparationFileName = "ui-preparation.json"
export const defaultDevReadinessPath = "/@arrange/modules"
