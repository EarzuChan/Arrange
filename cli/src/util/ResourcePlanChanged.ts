export class ResourcePlanChanged extends Error {
    constructor() { super("操作期间资源位置发生变化，需要重新规划占用") }
}
