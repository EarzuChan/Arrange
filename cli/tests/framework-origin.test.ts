import assert from "node:assert/strict"
import { test } from "node:test"
import { resolve } from "node:path"
import { stateFor } from "./fixture.ts"
import { defaultFetchUrl } from "../src/CliMetadata.ts"
import { frameworkRegistryUrl, frameworkRepositoryUrl, localFrameworkOriginProblem, resolveLocalRepository } from "../src/feature/framework/FrameworkOrigin.ts"
import { NativeSourceService } from "../src/feature/source/NativeSourceService.ts"
import type { SourceCache } from "../src/feature/source/SourceCache.ts"

test("本机来源优先于共享来源，未设置时回落到共享配置与官方默认", () => {
    const state = stateFor("E:/work/Demo")
    assert.equal(frameworkRegistryUrl(state), null)
    assert.equal(frameworkRepositoryUrl(state), defaultFetchUrl)
    state.project.framework.nodeRegistryUrl = "https://shared.example.test"
    state.project.framework.cmakeFetchContentUrl = "https://example.test/Arrange.git"
    assert.equal(frameworkRegistryUrl(state), "https://shared.example.test")
    assert.equal(frameworkRepositoryUrl(state), "https://example.test/Arrange.git")
    state.local = { framework: { nodeRegistryUrl: "http://localhost:4873", cmakeFetchContentUrl: "https://mirror.example.test/Arrange.git" } }
    assert.equal(frameworkRegistryUrl(state), "http://localhost:4873")
    assert.equal(frameworkRepositoryUrl(state), "https://mirror.example.test/Arrange.git")
})

test("本机仓库的相对路径按工程根解析，远端地址与绝对路径保持原样", () => {
    const root = resolve("work", "Demo")
    assert.equal(resolveLocalRepository(root, ".."), resolve("work").replaceAll("\\", "/"))
    assert.equal(resolveLocalRepository(root, "../Arrange"), resolve("work", "Arrange").replaceAll("\\", "/"))
    for (const value of ["https://github.com/EarzuChan/Arrange.git", "file:///E:/repo/Arrange", "ssh://git@example.test/Arrange.git", "git@github.com:EarzuChan/Arrange.git", resolve("absolute", "Arrange")]) assert.equal(resolveLocalRepository(root, value), value)
})

test("本机仓库覆盖在源码未托管或与源码目录覆盖并存时被拒绝", () => {
    const state = stateFor("E:/work/Demo")
    assert.equal(localFrameworkOriginProblem(state), undefined)
    state.local = { framework: { cmakeFetchContentUrl: ".." } }
    assert.equal(localFrameworkOriginProblem(state), undefined)
    state.project["managed-items"] = state.project["managed-items"].filter(item => item !== "cmake.fetch-content-repository")
    assert.match(localFrameworkOriginProblem(state)!, /未由 CLI 托管/)
    const conflicting = stateFor("E:/work/Demo")
    conflicting.local = { framework: { cmakeFetchContentUrl: ".." }, native: { generator: "Ninja", architecture: "x64", cmakeDefinitions: { FETCHCONTENT_SOURCE_DIR_ARRANGE: "E:/Arrange" } } }
    assert.match(localFrameworkOriginProblem(conflicting)!, /只能保留一种/)
    const registryOnly = stateFor("E:/work/Demo")
    registryOnly.project["managed-items"] = []
    registryOnly.local = { framework: { nodeRegistryUrl: "http://localhost:4873" } }
    assert.equal(localFrameworkOriginProblem(registryOnly), undefined)
})

test("源码准备按本机仓库解析出的绝对地址取 dev tag", () => {
    const state = stateFor(resolve("work", "Demo"))
    state.project.framework.version = "0.0.0-m.4.0-dev.1"
    state.local = { framework: { cmakeFetchContentUrl: ".." } }
    const spec = new NativeSourceService({} as SourceCache).frameworkSpec(state)
    assert.deepEqual(spec, { repository: resolve("work").replaceAll("\\", "/"), ref: "v0.0.0-m.4.0-dev.1" })
})
