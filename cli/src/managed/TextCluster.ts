import type {ProjectState} from "../project/ProjectState.ts"
import {TextRegion} from "./TextRegion.ts"
import {Wrapper, type WrappedLocation} from "./Wrapper.ts"

export abstract class TextCluster {
    readonly kind = "text-cluster"
    abstract readonly id: string
    abstract readonly regions: readonly TextRegion[]
    get wrapper(): Wrapper { return new Wrapper(`cluster:${this.id}`) }

    protected abstract makeInner(state: ProjectState): string

    make(state: ProjectState): string { return this.wrapper.make(this.makeInner(state)) }

    locate(_state: ProjectState, fileText: string): WrappedLocation { return this.wrapper.locate(fileText) }

    check(state: ProjectState, fileText: string) {
        const location = this.locate(state, fileText)
        if (location.kind !== "located") return {kind: "Resolvable" as const, cause: location.kind, message: location.kind === "missing" ? `缺少 ${this.id} Wrapper` : location.message}
        const inner = fileText.slice(location.inner.start, location.inner.end)
        const regions = this.regions.filter(region => region.enabled(state)).map(region => ({region, result: region.check(state, inner)}))
        return {kind: "Idle" as const, location, regions}
    }
}
