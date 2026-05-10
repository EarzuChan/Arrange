import {cmakeExe, ninjaExe, run, runInVsDev} from "./common.ts"
import {existsSync} from "node:fs"

const buildType = process.env.ARRANGE_DEMO_BUILD_TYPE ?? "Debug"
const buildDir = buildType === "Release" ? "build\\demo-ninja-release" : "build\\demo-ninja-debug"
const cmake = cmakeExe()
const ninja = ninjaExe()
const windowsKitBin = "C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64"
const toolchainArgs = [
    `${windowsKitBin}/mt.exe`,
    `${windowsKitBin}/rc.exe`,
].every((tool) => existsSync(tool))
    ? ` -DCMAKE_MT="${windowsKitBin}/mt.exe" -DCMAKE_RC_COMPILER="${windowsKitBin}/rc.exe"`
    : ""
const juceDirArg = process.env.JUCE_DIR
    ? ` -DJUCE_DIR="${process.env.JUCE_DIR}"`
    : ""
const quickJsDirArg = process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR
    ? ` -DARRANGE_QUICKJS_NG_SOURCE_DIR="${process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR}"`
    : ""

await run("node", ["scripts/build-demo-ui.ts"])
await runInVsDev(`"${cmake}" -S . -B ${buildDir} -G Ninja -DCMAKE_MAKE_PROGRAM="${ninja}" -DCMAKE_BUILD_TYPE=${buildType} -DARRANGE_WITH_QUICKJS_NG=ON -DARRANGE_BUILD_DEMO=ON -DARRANGE_BUILD_TESTS=ON${toolchainArgs}${juceDirArg}${quickJsDirArg}`)
await runInVsDev(`"${cmake}" --build ${buildDir}`)
