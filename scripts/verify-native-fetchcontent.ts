import {existsSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"
import {cmakeExe, ninjaExe, repoRoot, runInVsDev} from "./common.ts"
import {readArrangeVersionContract} from "./version-contract.ts"

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

if (existsSync(consumerRoot)) rmSync(consumerRoot, {recursive: true, force: true})
mkdirSync(consumerRoot, {recursive: true})

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

await runInVsDev(`"${cmakeExe()}" -S "${consumerRoot}" -B "${buildDir}" -G Ninja -DCMAKE_MAKE_PROGRAM="${ninjaExe()}" -DCMAKE_BUILD_TYPE=Debug`)
await runInVsDev(`"${cmakeExe()}" --build "${buildDir}"`)
await runInVsDev(`"${resolve(buildDir, "arrange_fetchcontent_consumer.exe")}"`)

const sourceLabel = gitRepository && gitTag ? `${gitRepository}#${gitTag}` : arrangeSource
console.log(`verified native FetchContent consumer for Arrange ${contract.frameworkVersion} from ${sourceLabel}`)
