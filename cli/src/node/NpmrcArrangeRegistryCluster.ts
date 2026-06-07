import {join} from "node:path"
import type {TextCluster, TextClusterLocation} from "../managed/TextCluster.ts"
import type {ProjectContext} from "../project/ProjectState.ts"

export class NpmrcArrangeRegistryCluster implements TextCluster {
    static readonly key = "NpmrcArrangeRegistryCluster"

    readonly id = NpmrcArrangeRegistryCluster.key
    readonly canEditMissingCluster = true

    filePath(context: ProjectContext): string {
        return join(context.state.project.ui.directory, ".npmrc")
    }

    locate(fileText: string): TextClusterLocation {
        return {
            kind: "found",
            span: {start: 0, end: fileText.length},
            text: fileText,
        }
    }

}

export function createNodeTextClusters(): readonly TextCluster[] {
    return [new NpmrcArrangeRegistryCluster()]
}
