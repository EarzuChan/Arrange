import assert from "node:assert/strict"
import { test } from "node:test"
import { createInitialProjectState, type CreateProjectRequest } from "../src/project/CreateProject.ts"
import { effectiveBundleId, effectiveDisplayName, generateDefaultBundleId } from "../src/project/ProjectMetadata.ts"
import { projectMetadataSchema, projectStateSchema } from "../src/project/ProjectState.ts"

function request(): CreateProjectRequest {
    return { rootDir: "/project", projectName: "My_Plugin2", projectVersion: "1.0.0", frameworkVersion: "0.0.0-m.3.0", vendorName: "Arrange 制造商 & Co.", vendorCode: "AbCd", pluginCode: "EfGh", pluginType: "effect", packageManager: "npm", products: ["standalone"], uiDirectory: "ui", nativeDirectory: "native", artifactsDirectory: "artifacts", managedItems: {} }
}

test("新工程显示名与 Bundle ID 一次生成；重命名不改变持久化身份或内部 target", () => {
    const state = createInitialProjectState(request())
    assert.equal(effectiveDisplayName(state), "My_Plugin2")
    assert.equal(state.project.project.bundleId, "com.arrangeco.myplugin2")
    assert.equal(generateDefaultBundleId({ vendorName: "中文厂商", vendorCode: "AbCd", projectName: "My_Plugin2" }), "com.abcd.myplugin2")
    state.project.project.name = "RenamedPlugin"
    state.project.project.displayName = "中文 产品名称"
    state.project.project.vendorName = "Another Company"
    assert.equal(effectiveBundleId(state), "com.arrangeco.myplugin2")
    assert.equal(effectiveDisplayName(state), "中文 产品名称")
    assert.equal(state.project.native.target, "My_Plugin2")
    assert.equal(state.project.project.icon, undefined)
    assert.equal(projectStateSchema.safeParse(state).success, true)
})

test("旧 YAML 可省略新增字段；既有 Bundle ID 大小写与 target 替换规则保持", () => {
    const state = createInitialProjectState(request())
    delete state.project.project.bundleId
    delete state.project.project.displayName
    state.project.native.target = "Original_Target+1"
    const loaded = projectStateSchema.parse(state)
    assert.equal(effectiveDisplayName(loaded), "My_Plugin2")
    assert.equal(effectiveBundleId(loaded), "com.arrange.abcd.Original-Target-1")
    loaded.project.project.bundleId = "com.Manufacturer.Product-1"
    assert.equal(effectiveBundleId(loaded), "com.Manufacturer.Product-1")
})

test("共享配置接受中文显示名和相对 PNG；拒绝跨平台非法文件名、标识与逃逸路径", () => {
    const metadata = createInitialProjectState(request()).project.project
    assert.equal(projectMetadataSchema.safeParse({ ...metadata, displayName: "中文 产品 & 名称", bundleId: "com.vendor.product", icon: "assets/中文 图标.PNG" }).success, true)
    for (const displayName of ["", "   ", "a/b", "a\\b", "a:b", "a?b", "a*b", "a\u0000b", "a\nb", "name.", "name ", "CON", "con.txt", "LPT1", "COM².txt"]) assert.equal(projectMetadataSchema.safeParse({ ...metadata, displayName }).success, false, displayName)
    for (const bundleId of ["", "product", "com..product", ".com.product", "com.product.", "com.厂商.product", "com.vendor_name.product", "com.-vendor.product", "com.vendor-.product", "com.vendor.product\n", " com.vendor.product"]) assert.equal(projectMetadataSchema.safeParse({ ...metadata, bundleId }).success, false, bundleId)
    for (const icon of ["/assets/icon.png", "C:/assets/icon.png", "assets\\icon.png", "../icon.png", "assets/../icon.png", "assets//icon.png", "assets/CON.png", "assets/icon.svg"]) assert.equal(projectMetadataSchema.safeParse({ ...metadata, icon }).success, false, icon)
})
