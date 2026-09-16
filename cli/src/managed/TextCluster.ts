import type {ProjectState} from "../project/ProjectState.ts"
import {TextRegion} from "./TextRegion.ts"
import {Wrapper, type WrappedLocation} from "./Wrapper.ts"

export class TextCluster {
    readonly kind = "text-cluster"
    readonly wrapper: Wrapper

    constructor(readonly id: string, readonly regions: readonly TextRegion[], private readonly body: (state: ProjectState) => string) {
        this.wrapper = new Wrapper(`cluster:${id}`)
    }

    make(state: ProjectState): string { return this.wrapper.make(this.body(state)) }

    locate(_state: ProjectState, fileText: string): WrappedLocation { return this.wrapper.locate(fileText) }

    check(state: ProjectState, fileText: string) {
        const location = this.locate(state, fileText)
        if (location.kind !== "located") return {kind: "Resolvable" as const, cause: location.kind, message: location.kind === "missing" ? `缺少 ${this.id} Wrapper` : location.message}
        const inner = fileText.slice(location.inner.start, location.inner.end)
        const regions = this.regions.filter(region => region.enabled(state)).map(region => ({region, result: region.check(state, inner)}))
        return {kind: "Idle" as const, location, regions}
    }
}
