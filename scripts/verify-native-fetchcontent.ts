import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot, run } from "./common.ts"
import { configureNativeBuild, nativeCmake, nativeExecutable } from "./native-toolchain.ts"
import { readArrangeVersionContract } from "./version-contract.ts"
import { withNativeSession, nativeSessionRun } from "./native-session.ts"

await withNativeSession(async () => {


    const contract = readArrangeVersionContract()
    const consumerRoot = resolve(repoRoot, "build/native-fetchcontent-consumer")
    const buildDir = resolve(consumerRoot, "build")
    const arrangeSource = repoRoot.replaceAll("\\", "/")
    const gitRepository = process.env.ARRANGE_FETCHCONTENT_GIT_REPOSITORY?.trim()
    const gitTag = process.env.ARRANGE_FETCHCONTENT_GIT_TAG?.trim()

    if (Boolean(gitRepository) !== Boolean(gitTag)) {
        throw new Error("ARRANGE_FETCHCONTENT_GIT_REPOSITORY and ARRANGE_FETCHCONTENT_GIT_TAG must be provided together")
    }

    function arrangeFetchContentDeclaration(): string {
        if (gitRepository && gitTag) {
            return [
                "FetchContent_Declare(arrange",
                `  GIT_REPOSITORY [[${gitRepository}]]`,
                `  GIT_TAG [[${gitTag}]]`,
                "  GIT_SHALLOW TRUE",
                ")",
            ].join("\n")
        }
        return `FetchContent_Declare(arrange SOURCE_DIR [[${arrangeSource}]])`
    }

    if (existsSync(consumerRoot)) rmSync(consumerRoot, { recursive: true, force: true })
    mkdirSync(consumerRoot, { recursive: true })

    writeFileSync(resolve(consumerRoot, "CMakeLists.txt"), `
cmake_minimum_required(VERSION 3.24)
project(ArrangeFetchContentConsumer LANGUAGES C CXX)
include(FetchContent)
${arrangeFetchContentDeclaration()}
FetchContent_MakeAvailable(arrange)
add_executable(arrange_fetchcontent_consumer main.cpp)
target_link_libraries(arrange_fetchcontent_consumer PRIVATE Arrange::framework)
`.trimStart())

    writeFileSync(resolve(consumerRoot, "main.cpp"), `
#include <arrange/core/Version.h>

int main() {
    static_assert(arrange::core::RuntimeVersion == ${contract.frameworkInternalProtocolCode}u);
    return arrange::core::version()[0] == '\\0';
}
`.trimStart())

    await configureNativeBuild(consumerRoot, buildDir, "Debug")
    await nativeCmake(["--build", buildDir])
    await nativeSessionRun(nativeExecutable(buildDir, "arrange_fetchcontent_consumer"))

    const sourceLabel = gitRepository && gitTag ? `${gitRepository}#${gitTag}` : arrangeSource
    console.log('[ArrangeNativeVerify]', `verified native FetchContent consumer for Arrange ${contract.frameworkVersion} from ${sourceLabel}`)

}, [resolve(repoRoot, "build/native-fetchcontent-consumer/build")])
