import type { ProjectState } from "../project/ProjectState.ts"
import type { TextRegion } from "./TextRegion.ts"
import { Wrapper, type WrappedLocation } from "./Wrapper.ts"
import type { Located, StructureCheckResult } from "./CheckResult.ts"

export abstract class TextCluster {
    readonly kind = "text-cluster"
    abstract readonly id: string
    abstract readonly regions: readonly TextRegion[]
    get wrapper(): Wrapper { return new Wrapper(`cluster:${this.id}`) }

    protected abstract makeInner(state: ProjectState): string

    make(state: ProjectState): string { return this.wrapper.make(this.makeInner(state)) }

    locate(_state: ProjectState, fileText: string): WrappedLocation { return this.wrapper.locate(fileText) }

    check(state: ProjectState, fileText: string): StructureCheckResult<Located> {
        const location = this.locate(state, fileText)
        return location.kind === "located" ? { kind: "Idle", location } : { kind: "Resolvable", cause: location.kind, message: location.kind === "missing" ? `缺少 ${this.id} Wrapper` : location.message }
    }
}
