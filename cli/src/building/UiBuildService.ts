import { NodeJsService } from "../node-js/NodeJsService.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { recordBuild } from "./BuildReceipt.ts"

export class UiBuildService {
    constructor(private readonly node: NodeJsService) { }
    build(state: ProjectState, clean = false): Promise<string> { return recordBuild(state, "ui", {}, () => this.node.build(state, clean), path => ({ path })) }
}
