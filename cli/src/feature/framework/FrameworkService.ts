import { join } from "node:path"
import { defaultFetchUrl, frameworkPackageName } from "../../CliMetadata.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { uiDirectory } from "../project/ProjectPaths.ts"
import { readSnapshot } from "../../util/FileUtils.ts"
import { isJsonObject } from "../../util/Utils.ts"
import { RegistryUnreachableError } from "./FrameworkErrors.ts"
import { FrameworkRegistryClient, normalizeRegistryUrl } from "./FrameworkRegistryClient.ts"
import { addIncompatibilityIfPresenceFor, assertFrameworkCompatible, readCliCompatibility, type FrameworkVersionCandidate } from "./FrameworkMamba.ts"
import type { SourceCache } from '../source/SourceCache.ts'
import type { GitSource } from '../source/GitSource.ts'
import type { TaskOutput } from '../operation/Work.ts'
import { assertFrameworkSource } from './FrameworkSourceMetadata.ts'
import { frameworkRegistryUrl } from './FrameworkOrigin.ts'
import { isConcreteVersion } from '../../util/Semver.ts'
import type { Operations } from '../operation/Operations.ts'

export interface FrameworkSelectionInput { readonly registryUrl?: string, readonly repositoryUrl?: string }
export interface VerifiedFrameworkVersion {
    readonly version: string
    readonly cliCompatibility: number
    readonly registryUrl: string
    readonly repositoryUrl: string
    readonly commit: string
}

export interface FrameworkSelectionSources {
    readonly git: Pick<GitSource, 'resolveTag'>
    readonly cache: Pick<SourceCache, 'ensure'>
    readonly operations: Pick<Operations, 'run'>
    readonly directory: string
}

export type FrameworkCompatibilityMode = "remote" | "installed-first"

export class FrameworkService {
    constructor(private readonly registry: FrameworkRegistryClient, private readonly sources?: FrameworkSelectionSources) { }

    async candidates(registryUrl?: string) {
        return addIncompatibilityIfPresenceFor(await this.registry.fetchCandidates(5, registryUrl))
    }

    async selectVersion(version: string, input: FrameworkSelectionInput, task: TaskOutput): Promise<VerifiedFrameworkVersion> {
        return this.verifyCandidate(await this.remoteVersion(version, input.registryUrl), input, task)
    }

    async verifyCandidate(candidate: FrameworkVersionCandidate, input: FrameworkSelectionInput, task: TaskOutput): Promise<VerifiedFrameworkVersion> {
        const { version } = candidate
        if (!isConcreteVersion(version)) throw new Error('Framework 必须使用具体的 SemVer 版本号')
        assertFrameworkCompatible(candidate)
        const registryUrl = normalizeRegistryUrl(input.registryUrl)
        if (!this.sources) throw new Error('Framework 版本准入未装配源码验证服务')
        const sources = this.sources
        const repositoryUrl = input.repositoryUrl ?? defaultFetchUrl
        const spec = { repository: repositoryUrl, ref: `v${version}` }
        return sources.operations.run([{ kind: 'directory', path: sources.directory, mode: 'read' }], '验证 Framework 源码', async () => {
            const commit = await sources.git.resolveTag(repositoryUrl, spec.ref)
            const source = await sources.cache.ensure(spec, 'Arrange', task, async source => {
                if (source.commit !== commit) throw new Error(`Arrange ${spec.ref} 的源码 commit 与远端 tag 不一致；拒绝使用未确认的源码`)
                await assertFrameworkSource(source.directory, version)
            })
            return Object.freeze({ version, cliCompatibility: candidate.cliCompatibility, registryUrl, repositoryUrl, commit: source.commit })
        }, false, message => task.waiting(message))
    }

    private async remoteVersion(version: string, registryUrl?: string) {
        if (!isConcreteVersion(version)) throw new Error('Framework 必须使用具体的 SemVer 版本号')
        const candidate = await this.registry.fetchCandidateByVersion(version, registryUrl)
        if (candidate.version !== version) throw new Error('registry 返回的 Framework 版本与请求不符')
        assertFrameworkCompatible(candidate)
        return candidate
    }

    async assertCompatible(state: ProjectState, mode: FrameworkCompatibilityMode): Promise<void> {
        if (mode === "installed-first" && await this.assertInstalledCompatible(state)) return
        try {
            await this.remoteVersion(state.project.framework.version, frameworkRegistryUrl(state) ?? undefined)
        } catch (error) {
            // 联网也不行时说明为什么没能用本机已装的版本判定，让用户知道还差一步安装或联网
            if (mode === "installed-first" && error instanceof RegistryUnreachableError) throw error.withNote(`本机 UI 目录里没有可用于离线验证的 ${frameworkPackageName}@${state.project.framework.version}`)
            throw error
        }
    }

    private async assertInstalledCompatible(state: ProjectState): Promise<boolean> {
        const path = join(uiDirectory(state), "node_modules", frameworkPackageName, "package.json")
        const snapshot = await readSnapshot(path)
        if (snapshot.content === null) return false
        let manifest: unknown
        try { manifest = JSON.parse(snapshot.content) } catch (error) { throw new Error(`已安装的 Framework package.json 无法解析：${path}`, { cause: error }) }
        if (!isJsonObject(manifest) || typeof manifest.version !== "string" || !manifest.version) throw new Error(`已安装的 Framework package.json 缺少有效 version：${path}`)
        if (manifest.version !== state.project.framework.version) return false
        const compatibility = readCliCompatibility(isJsonObject(manifest.arrange) ? manifest.arrange.cliCompatibility : null)
        if (compatibility === null) throw new Error(`已安装的 Framework ${manifest.version} 未声明有效的 arrange.cliCompatibility：${path}`)
        assertFrameworkCompatible({ version: manifest.version, cliCompatibility: compatibility })
        return true
    }
}
