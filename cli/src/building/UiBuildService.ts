import { NodeJsService } from "../node-js/NodeJsService.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { recordBuild } from "./BuildReceipt.ts"
import type { TaskOutput } from "../ui/Tasks.ts"

export class UiBuildService {
    constructor(private readonly node: NodeJsService) { }
    build(state: ProjectState, task: TaskOutput, clean = false): Promise<string> { return recordBuild(state, "ui", {}, () => this.node.build(state, task, clean), path => ({ path })) }
}
