import assert from "node:assert/strict"
import { mkdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import test from "node:test"
import { Executor } from "../src/platform/Executor.ts"
import { locateTool } from "../src/platform/ToolLocator.ts"
import { fixture, write } from "./fixture.ts"

test("真实 CMake 读取与 CLI 相同的依赖清单，默认 commit 校验且尊重显式覆盖", async t => {
    const cmake = await locateTool("cmake")
    if (!cmake) return t.skip("需要 CMake")
    const state = await fixture(t, false)
    const executor = new Executor()
    const source = join(state.rootDir, "source")
    await mkdir(source)
    for (const args of [["init", "--quiet"], ["config", "user.email", "fixture@example.invalid"], ["config", "user.name", "Fixture"]]) assert.equal((await executor.run({ command: "git", args, cwd: source })).exitCode, 0)
    await write(join(source, "CMakeLists.txt"), "project(Fixture NONE)\n")
    for (const args of [["add", "."], ["commit", "--quiet", "-m", "fixture"]]) assert.equal((await executor.run({ command: "git", args, cwd: source })).exitCode, 0)
    const commit = (await executor.run({ command: "git", args: ["rev-parse", "HEAD"], cwd: source })).stdout.trim()
    const directory = join(state.rootDir, "cmake")
    await write(join(directory, "Dependencies.cmake"), await readFile(resolve(import.meta.dirname, "../../cmake/Dependencies.cmake"), "utf8"))
    const dependency = { repository: "https://example.invalid/source", ref: "v1", commit }
    await write(join(directory, "NativeDependencies.json"), JSON.stringify({ schema: 1, juce: dependency, quickjs_ng: dependency }))
    const script = join(state.rootDir, "verify.cmake")
    const body = `cmake_minimum_required(VERSION 3.24)\ninclude([[${join(directory, "Dependencies.cmake")}]])\narrange_validate_dependency(JUCE [[${source}]])\n`
    const run = async (text: string) => {
        await write(script, text)
        return executor.run({ command: cmake, args: ["-P", script], cwd: state.rootDir })
    }
    const valid = await run(body)
    assert.equal(valid.exitCode, 0, valid.stderr)
    await write(join(directory, "NativeDependencies.json"), JSON.stringify({ schema: 1, juce: { ...dependency, commit: "a".repeat(40) }, quickjs_ng: dependency }))
    const invalid = await run(body)
    assert.notEqual(invalid.exitCode, 0)
    assert.match(invalid.stderr, /does not match the pinned/)
    const explicit = await run(body.replace("arrange_validate_dependency", "set(FETCHCONTENT_SOURCE_DIR_JUCE explicit)\narrange_validate_dependency"))
    assert.equal(explicit.exitCode, 0, explicit.stderr)
})
