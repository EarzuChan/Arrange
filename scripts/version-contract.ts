import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {repoRoot} from "./common.ts"

export type ArrangeVersionContract = {
    version: string
    protocolVersion: number
}

type JsonObject = Record<string, unknown>

const milestoneVersionPattern = /^0\.0\.0-m\.(\d+)\.(\d+)$/

export const versionFile = resolve(repoRoot, "arrange.version.json")

export function readArrangeVersionContract(): ArrangeVersionContract {
    const parsed = JSON.parse(readFileSync(versionFile, "utf8").replace(/^\uFEFF/, "")) as Partial<ArrangeVersionContract>
    if (typeof parsed.version !== "string" || !milestoneVersionPattern.test(parsed.version)) {
        throw new Error(`Arrange version must use 0.0.0-m.<N>.<sub>, got ${String(parsed.version)}`)
    }
    const protocolVersion = parsed.protocolVersion
    if (typeof protocolVersion !== "number" || !Number.isInteger(protocolVersion) || protocolVersion <= 0) {
        throw new Error(`Arrange protocolVersion must be a positive integer, got ${String(parsed.protocolVersion)}`)
    }
    return {version: parsed.version, protocolVersion}
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
        manifest.version = contract.version
        for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const dependencies = manifest[field]
            if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue
            const dependencyRecord = dependencies as Record<string, unknown>
            for (const name of Object.keys(dependencyRecord)) {
                if (name.startsWith("@arrange/")) {
                    dependencyRecord[name] = contract.version
                }
            }
        }
        writeJson(path, manifest)
    }

    const runtimeVersionPath = resolve(repoRoot, "packages/runtime/src/version.ts")
    writeFileSync(runtimeVersionPath, [
        `export const ARRANGE_PACKAGE_VERSION = ${JSON.stringify(contract.version)}`,
        `export const ARRANGE_PROTOCOL_VERSION = ${contract.protocolVersion}`,
        "",
    ].join("\n"))

    const nativeHeaderPath = resolve(repoRoot, "native/arrange_core/include/arrange/core/Version.h")
    writeFileSync(nativeHeaderPath, [
        "#pragma once",
        "namespace arrange::core {",
        `    inline constexpr unsigned RuntimeVersion = ${contract.protocolVersion}u;`,
        "    inline constexpr unsigned ProtocolVersion = RuntimeVersion;",
        `    inline constexpr const char* PackageVersion = ${JSON.stringify(contract.version)};`,
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
        assertEqual(manifest.version, contract.version, `${path} version diverges from arrange.version.json`)
        for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const dependencies = manifest[field]
            if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue
            for (const [name, spec] of Object.entries(dependencies as Record<string, unknown>)) {
                if (name.startsWith("@arrange/")) {
                    assertEqual(spec, contract.version, `${path} ${field}.${name} diverges from arrange.version.json`)
                }
            }
        }
    }
    assertFileContains(resolve(repoRoot, "packages/runtime/src/version.ts"), `ARRANGE_PACKAGE_VERSION = ${JSON.stringify(contract.version)}`)
    assertFileContains(resolve(repoRoot, "packages/runtime/src/version.ts"), `ARRANGE_PROTOCOL_VERSION = ${contract.protocolVersion}`)
    assertFileContains(resolve(repoRoot, "native/arrange_core/include/arrange/core/Version.h"), `RuntimeVersion = ${contract.protocolVersion}u`)
    assertFileContains(resolve(repoRoot, "native/arrange_core/include/arrange/core/Version.h"), `PackageVersion = ${JSON.stringify(contract.version)}`)
}
