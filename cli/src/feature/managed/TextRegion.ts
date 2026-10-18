import { errorMessage } from "../../util/Utils.ts"
import { normalizeLineEndings } from "../../util/LineEnding.ts"
import { isManagedItem, type ProjectState } from "../project/ProjectState.ts"
import { type CheckResult, type Located } from "./CheckResult.ts"
import { Wrapper, type WrappedLocation } from "./Wrapper.ts"

export abstract class TextRegion {
    readonly kind = "text-region"
    abstract readonly id: string
    abstract readonly managedItemId: string
    get wrapper(): Wrapper { return new Wrapper(`region:${this.id}`) }

    protected abstract makeInner(state: ProjectState): string

    enabled(state: ProjectState): boolean { return isManagedItem(state, this.managedItemId) }

    make(state: ProjectState): string {
        const inner = this.makeInner(state)
        return this.enabled(state) ? this.wrapper.make(inner) : inner
    }

    locate(_state: ProjectState, clusterInnerText: string): WrappedLocation { return this.wrapper.locate(clusterInnerText) }

    check(state: ProjectState, clusterInnerText: string): CheckResult<string, Located> {
        let expected: string
        try { expected = this.makeInner(state) } catch (error) { return { kind: "Fatal", cause: "config-invalid", message: errorMessage(error) } }
        const location = this.locate(state, clusterInnerText)
        if (location.kind !== "located") return { kind: "Resolvable", cause: location.kind, message: location.kind === "missing" ? `缺少 ${this.id} Wrapper` : location.message, expected }
        const actual = clusterInnerText.slice(location.inner.start, location.inner.end)
        // 期望值是 LF 逻辑文本；文件为 CRLF 时仅换行风格不同不算过期
        return normalizeLineEndings(actual) === expected ? { kind: "Idle", actual, expected, location } : { kind: "Applicable", cause: "outdated", actual, expected, location }
    }
}