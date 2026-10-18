import { join } from "node:path"
import type { ProjectRegistry } from "../user/ProjectRegistry.ts"
import type { ProjectStateStore } from "../project/ProjectStateStore.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { inspectionFailure, type InspectionFact } from "../../util/RecordInspection.ts"

export class ProjectInspection {
    private readonly checks = new Map<string, Promise<{ check: InspectionFact, state?: ProjectState }>>()
    constructor(private readonly projects: ProjectRegistry, private readonly store: ProjectStateStore) { }

    inspect(root: string, verification = false): Promise<{ check: InspectionFact, state?: ProjectState }> {
        const key = `${verification}:${root}`
        if (!this.checks.has(key)) this.checks.set(key, this.read(root, verification))
        return this.checks.get(key)!
    }

    private async read(root: string, verification: boolean): Promise<{ check: InspectionFact, state?: ProjectState }> {
        const availability = await this.projects.availability(root, verification)
        if (availability !== "present") return { check: { state: availability, path: root, reason: { missing: "设备可访问，但登记的工程路径已不存在，可能已删除或移动", replaced: "路径存在，但已不是登记的工程", unavailable: "设备身份、权限或文件系统状态无法确认，不能认定工程已丢失" }[availability] } }
        if (verification) return { check: { state: "ready", path: root, reason: "验收源码根存在" } }
        const path = join(root, "arrange.project.yaml")
        try {
            const result = await this.store.deepLoad(root)
            if (!result.state || result.errors.length) return { check: { state: result.errors.find(error => error.state === "unavailable")?.state ?? result.errors[0]?.state ?? "damaged", path, reason: result.errors.map(error => `${error.path}：${error.message}`).join("；") || "工程配置不符合当前结构" } }
            return { check: { state: "ready", path: root, reason: "工程目录与当前结构配置有效" }, state: result.state }
        } catch (error) { return { check: inspectionFailure(error, path) } }
    }
}
