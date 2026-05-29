import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {repoRoot} from "./common.ts"

export type ArrangeVersionContract = {
    frameworkVersion: string
    frameworkInternalProtocolCode: number
    cliVersion: string
    cliCompatibility: number
}

type JsonObject = Record<string, unknown>

const milestoneVersionPattern = /^0\.0\.0-m\.(\d+)\.(\d+)$/
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const versionFile = resolve(repoRoot, "arrange.version.json")

export function readArrangeVersionContract(): ArrangeVersionContract {
    const parsed = JSON.parse(readFileSync(versionFile, "utf8").replace(/^\uFEFF/, "")) as Partial<ArrangeVersionContract>
    const frameworkVersion = parsed.frameworkVersion
    if (typeof frameworkVersion !== "string" || !milestoneVersionPattern.test(frameworkVersion)) throw new Error(`Arrange frameworkVersion must use 0.0.0-m.<N>.<sub>, got ${String(frameworkVersion)}`)
    const frameworkInternalProtocolCode = parsed.frameworkInternalProtocolCode
    if (typeof frameworkInternalProtocolCode !== "number" || !Number.isInteger(frameworkInternalProtocolCode) || frameworkInternalProtocolCode <= 0) throw new Error(`Arrange frameworkInternalProtocolCode must be a positive integer, got ${String(frameworkInternalProtocolCode)}`)
    const cliVersion = parsed.cliVersion
    if (typeof cliVersion !== "string" || !semverPattern.test(cliVersion)) throw new Error(`Arrange cliVersion must be semver, got ${String(cliVersion)}`)
    const cliCompatibility = parsed.cliCompatibility
    if (typeof cliCompatibility !== "number" || !Number.isInteger(cliCompatibility) || cliCompatibility <= 0) throw new Error(`Arrange cliCompatibility must be a positive integer, got ${String(cliCompatibility)}`)
    return {frameworkVersion, frameworkInternalProtocolCode, cliVersion, cliCompatibility}
}

function readJson(path: string): JsonObject {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as JsonObject
}

function writeJson(path: string, value: JsonObject): void {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function packageJsonPaths(): string[] {
    const packagesRoot = resolve(repoRoot, "packages")
    return [
        resolve(repoRoot, "package.json"),
        resolve(repoRoot, "demo/ui-src/package.json"),
        ...readdirSync(packagesRoot)
            .map((name) => resolve(packagesRoot, name, "package.json"))
            .filter((path) => existsSync(path)),
    ]
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertFileContains(path: string, expected: string): void {
    const source = readFileSync(path, "utf8")
    if (!source.includes(expected)) throw new Error(`${path} does not contain ${expected}`)
}

export function syncArrangeVersionContract(): void {
    const contract = readArrangeVersionContract()
    for (const path of packageJsonPaths()) {
        const manifest = readJson(path)
        manifest.version = contract.frameworkVersion
        for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const dependencies = manifest[field]
            if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue
            const dependencyRecord = dependencies as Record<string, unknown>
            for (const name of Object.keys(dependencyRecord)) if (name.startsWith("@arrange/")) dependencyRecord[name] = contract.frameworkVersion
        }
        writeJson(path, manifest)
    }

    const frameworkManifestPath = resolve(repoRoot, "packages/framework/package.json")
    const frameworkManifest = readJson(frameworkManifestPath)
    const arrange = frameworkManifest.arrange
    if (!arrange || typeof arrange !== "object" || Array.isArray(arrange)) frameworkManifest.arrange = {}
    ;(frameworkManifest.arrange as Record<string, unknown>).cliCompatibility = contract.cliCompatibility
    writeJson(frameworkManifestPath, frameworkManifest)

    const cliManifestPath = resolve(repoRoot, "cli/package.json")
    const cliManifest = readJson(cliManifestPath)
    cliManifest.version = contract.cliVersion
    writeJson(cliManifestPath, cliManifest)

    const runtimeVersionPath = resolve(repoRoot, "packages/runtime/src/version.ts")
    writeFileSync(runtimeVersionPath, [
        `export const ARRANGE_PACKAGE_VERSION = ${JSON.stringify(contract.frameworkVersion)}`,
        `export const ARRANGE_PROTOCOL_VERSION = ${contract.frameworkInternalProtocolCode}`,
        "",
    ].join("\n"))

    const cliConstantsPath = resolve(repoRoot, "cli/src/constants.ts")
    writeFileSync(cliConstantsPath, [
        `export const CLI_VERSION = ${JSON.stringify(contract.cliVersion)}`,
        `export const CLI_COMPATIBILITY = ${contract.cliCompatibility}`,
        `export const DEFAULT_FRAMEWORK_VERSION = ${JSON.stringify(contract.frameworkVersion)}`,
        `export const DEFAULT_DEV_HOST = "127.0.0.1"`,
        `export const DEFAULT_DEV_PORT = 9178`,
        "",
    ].join("\n"))

    const nativeHeaderPath = resolve(repoRoot, "native/arrange_core/include/arrange/core/Version.h")
    writeFileSync(nativeHeaderPath, [
        "#pragma once",
        "namespace arrange::core {",
        `    inline constexpr unsigned RuntimeVersion = ${contract.frameworkInternalProtocolCode}u;`,
        "    inline constexpr unsigned ProtocolVersion = RuntimeVersion;",
        `    inline constexpr const char* PackageVersion = ${JSON.stringify(contract.frameworkVersion)};`,
        "    const char* version() noexcept;",
        "}",
        "",
    ].join("\n"))

    const nativeSourcePath = resolve(repoRoot, "native/arrange_core/src/Version.cpp")
    writeFileSync(nativeSourcePath, [
        "#include <arrange/core/Version.h>",
        "",
        "namespace arrange::core {",
        "    const char* version() noexcept { return PackageVersion; }",
        "}",
        "",
    ].join("\n"))
}

export function assertArrangeVersionContract(): void {
    const contract = readArrangeVersionContract()
    for (const path of packageJsonPaths()) {
        const manifest = readJson(path)
        assertEqual(manifest.version, contract.frameworkVersion, `${path} version diverges from arrange.version.json`)
        for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const dependencies = manifest[field]
            if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue
            for (const [name, spec] of Object.entries(dependencies as Record<string, unknown>)) {
                if (name.startsWith("@arrange/")) {
                    assertEqual(spec, contract.frameworkVersion, `${path} ${field}.${name} diverges from arrange.version.json`)
                }
            }
        }
    }
    assertFileContains(resolve(repoRoot, "packages/runtime/src/version.ts"), `ARRANGE_PACKAGE_VERSION = ${JSON.stringify(contract.frameworkVersion)}`)
    assertFileContains(resolve(repoRoot, "packages/runtime/src/version.ts"), `ARRANGE_PROTOCOL_VERSION = ${contract.frameworkInternalProtocolCode}`)
    assertFileContains(resolve(repoRoot, "native/arrange_core/include/arrange/core/Version.h"), `RuntimeVersion = ${contract.frameworkInternalProtocolCode}u`)
    assertFileContains(resolve(repoRoot, "native/arrange_core/include/arrange/core/Version.h"), `PackageVersion = ${JSON.stringify(contract.frameworkVersion)}`)
    assertFileContains(resolve(repoRoot, "cli/src/constants.ts"), `CLI_VERSION = ${JSON.stringify(contract.cliVersion)}`)
    assertFileContains(resolve(repoRoot, "cli/src/constants.ts"), `CLI_COMPATIBILITY = ${contract.cliCompatibility}`)
    assertFileContains(resolve(repoRoot, "cli/src/constants.ts"), `DEFAULT_FRAMEWORK_VERSION = ${JSON.stringify(contract.frameworkVersion)}`)

    const cliManifest = readJson(resolve(repoRoot, "cli/package.json"))
    assertEqual(cliManifest.version, contract.cliVersion, "cli/package.json version diverges from arrange.version.json")

    const frameworkManifest = readJson(resolve(repoRoot, "packages/framework/package.json"))
    const arrange = frameworkManifest.arrange
    if (!arrange || typeof arrange !== "object" || Array.isArray(arrange)) throw new Error("packages/framework/package.json arrange metadata missing")
    assertEqual((arrange as Record<string, unknown>).cliCompatibility, contract.cliCompatibility, "framework cliCompatibility diverges from arrange.version.json")
}
