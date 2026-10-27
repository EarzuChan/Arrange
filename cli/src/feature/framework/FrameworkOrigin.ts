import { isAbsolute, resolve } from "node:path"
import { defaultFetchUrl } from "../../CliMetadata.ts"
import { isManagedItem, type ProjectState } from "../project/ProjectState.ts"

// Framework 获取来源：共享配置声明工程的正式来源，本机配置可覆盖为本机来源（本地 registry、本地仓库）
// 本机覆盖只影响 CLI 驱动的依赖获取与源码准备，不改写共享的 CMakeLists

export function frameworkRegistryUrl(state: ProjectState): string | null {
    return state.local?.framework?.nodeRegistryUrl ?? state.project.framework.nodeRegistryUrl ?? null
}

export function frameworkRepositoryUrl(state: ProjectState): string {
    const local = state.local?.framework?.cmakeFetchContentUrl
    if (local !== undefined) return resolveLocalRepository(state.rootDir, local)
    return state.project.framework.cmakeFetchContentUrl ?? defaultFetchUrl
}

export function hasLocalFrameworkRepository(state: ProjectState): boolean {
    return state.local?.framework?.cmakeFetchContentUrl !== undefined
}

// 本机仓库可写相对工程根的路径；各阶段工作目录不同，必须先解析为绝对路径
export function resolveLocalRepository(rootDir: string, value: string): string {
    if (isRemoteRepository(value) || isAbsolute(value)) return value
    return resolve(rootDir, value).replaceAll("\\", "/")
}

function isRemoteRepository(value: string): boolean {
    return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || /^[^/\\@]+@[^/\\:]+:/.test(value)
}

// 本机仓库覆盖只经 CLI 源码缓存交给 CMake；源码不由 CLI 托管或已直接指定源码目录时，覆盖不会生效，须明确拒绝
export function localFrameworkOriginProblem(state: ProjectState): string | undefined {
    if (!hasLocalFrameworkRepository(state)) return undefined
    if (!isManagedItem(state, "cmake.fetch-content-repository") || !isManagedItem(state, "framework.version")) return "arrange.local.yaml 设置了 framework.cmakeFetchContentUrl，但 Framework 仓库地址或版本未由 CLI 托管，本机仓库覆盖无法生效"
    if (state.local?.native?.cmakeDefinitions?.FETCHCONTENT_SOURCE_DIR_ARRANGE !== undefined) return "arrange.local.yaml 同时设置了 framework.cmakeFetchContentUrl 与 FETCHCONTENT_SOURCE_DIR_ARRANGE，两种本机来源只能保留一种"
    return undefined
}
