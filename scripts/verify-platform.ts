import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { run, repoRoot } from "./common.ts"
import { assertSupportedPlatform } from "../cli/src/util/CliEnvironment.ts"

assertSupportedPlatform(process.platform)
const evidence = resolve(repoRoot, ".arrange/verification", `${process.platform}-${process.arch}`)
await mkdir(evidence, { recursive: true })
for (const [name, glob] of [["framework", "tests/**/*.test.ts"], ["cli", "cli/tests/*.test.ts"]]) {
    await run(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", `--test-reporter=${pathToFileURL(resolve(repoRoot, "scripts/platform-test-reporter.ts")).href}`, "--test-reporter-destination=stdout", `--test-reporter-destination=${resolve(evidence, `${name}.json`)}`, glob])
}
await run(process.execPath, ["--import", "tsx", "scripts/test-native.ts", ...(process.argv.includes("--clean") ? ["--clean"] : [])])
console.log("[ArrangePlatformVerify]", `${process.platform}/${process.arch} 本机自动化通过；交互控制台和主人真实工程验收另行记录`)
