// 在实际执行入口计数；用于验证结构域与值域，不能由计划的 dirty 标志推算
export const arrangeExecutionStats = {
    structureRuns: 0,
    valueEvaluations: 0,
    valueWrites: 0,
    activeValueBindings: 0,
    parameterNameChecks: 0,
    parameterCacheHits: 0,
    parameterPositionReads: 0,
    instancesCreated: 0,
    instancesReused: 0,
    instancesRetired: 0,
    rearrangeNodesCreated: 0,
    rearrangeNodesRetired: 0,
    nativeCreateOperations: 0,
    nativeRemoveOperations: 0,
    nativeInsertOperations: 0,
}

export function getArrangeExecutionStats(): Readonly<typeof arrangeExecutionStats> {
    return {...arrangeExecutionStats}
}
