import type {ProjectStateStore} from "../project/ProjectStateStore.ts"
import {ProjectState} from "../project/ProjectState.ts";

export interface SyncRunOptions {
    readonly scanOnly: boolean // 仅执行SCAN阶段，并打印可读的报告

    readonly configOnly: boolean // 仅搞CONFIG的PART
    readonly setupOnly: boolean // 仅搞SETUP的PART

    readonly uiOnly: boolean // 每PART中只搞UI项目（NODE）相关
    readonly nativeOnly: boolean // 每PART中只搞NATIVE项目（CMAKE）相关
}

export class SyncService {
    constructor(private readonly projectStateStore: ProjectStateStore) { }

    async run(options: SyncRunOptions, state: ProjectState): Promise<void> {

    }
}
