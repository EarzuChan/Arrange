// 在实际执行入口计数；用于验证结构域与值域，不能由计划的 dirty 标志推算。
export const arrangeExecutionStats = {
    structureRuns: 0,
    valueEvaluations: 0,
    valueEvaluationMillis: 0,
    valueWrites: 0,
    activeValueBindings: 0,
}

export function getArrangeExecutionStats(): Readonly<typeof arrangeExecutionStats> {
    return {...arrangeExecutionStats}
}
