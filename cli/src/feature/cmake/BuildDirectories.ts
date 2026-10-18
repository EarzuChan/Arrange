import { access, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { BuildFlavor, ProjectState } from "../project/ProjectState.ts"
import type { PlatformService } from "../platform/PlatformService.ts"
import { UserDirectories } from "../user/UserDirectories.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { buildOwnerFileName } from "../../CliMetadata.ts"
import { withKernelLock } from "../operation/KernelLock.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"
import { buildOwnerRecordSchema, nativeBuildRootIdentity, nativeBuildRootKey } from "./BuildOwnerRecord.ts"
import { readCurrentRecord } from "../../util/RecordInspection.ts"

export class BuildDirectories {
    private readonly claims = new Map<string, Promise<void>>()

    constructor(private readonly platform: PlatformService["name"], private readonly user: UserDirectories, private readonly signal = new AbortController().signal) { }

    anchor(state: ProjectState): string {
        return state.local?.native?.buildRoot ? resolve(state.rootDir, state.local.native.buildRoot) : this.user.builds
    }

    private identity(root: string): string {
        return nativeBuildRootIdentity(root, this.platform)
    }

    private base(state: ProjectState): string {
        const digest = nativeBuildRootKey(state.rootDir, this.platform)
        return join(this.anchor(state), digest)
    }

    directory(state: ProjectState, flavor: BuildFlavor): string {
        const arch = state.local?.native?.architecture
        if (!arch) throw new Error("本机 native 工具环境尚未准备，请先运行 arrange sync --setup")
        const configuration = `${arch === "arm64" ? "a" : "x"}${flavor === "debug" ? "d" : "r"}`
        return join(this.base(state), this.platform === "darwin" ? `mac-${configuration}` : configuration)
    }

    async assert(state: ProjectState, flavor: BuildFlavor): Promise<void> {
        const anchor = this.anchor(state)
        try { await access(anchor) } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return
            throw error
        }
        if (!state.local?.native?.buildRoot) await assertPlainDirectoryPath(this.user.root, anchor)
        await assertPlainDirectoryPath(anchor, this.directory(state, flavor))
    }

    async claim(state: ProjectState): Promise<void> {
        const base = this.base(state)
        let claim = this.claims.get(base)
        if (!claim) {
            claim = this.claimBase(state, base)
            this.claims.set(base, claim)
            claim.catch(() => this.claims.delete(base))
        }
        await claim
    }

    private async claimBase(state: ProjectState, base: string): Promise<void> {
        if (state.local?.native?.buildRoot) await mkdir(this.anchor(state), { recursive: true })
        else await this.user.ensure(this.anchor(state))
        await assertPlainDirectoryPath(this.anchor(state), base)
        await mkdir(base, { recursive: true })
        const ownerPath = join(base, buildOwnerFileName)
        const rootDir = resolve(state.rootDir)
        await withKernelLock(`${ownerPath}.kernel`, this.signal, async signal => {
            let existing: { rootDir?: unknown } | undefined
            try { existing = await readCurrentRecord(ownerPath, buildOwnerRecordSchema) } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`构建目录所有权记录不可读：${ownerPath}`, { cause: error })
            }
            if (existing) {
                if (typeof existing.rootDir !== "string" || this.identity(existing.rootDir) !== this.identity(rootDir)) throw new Error(`构建目录已被另一个工程占用：${base}。请在 arrange.local.yaml 的 native.buildRoot 指定其它位置`)
                return
            }
            await writeAtomicText(ownerPath, `${JSON.stringify({ rootDir }, null, 4)}\n`, signal)
        })
    }
}
