// 编译器给结构协调的提示；负值表示互斥的特殊模式
export enum PatchFlags {
    TEXT = 1,
    PROPS = 1 << 3,
    FULL_PROPS = 1 << 4,
    STABLE_FRAGMENT = 1 << 6,
    KEYED_FRAGMENT = 1 << 7,
    UNKEYED_FRAGMENT = 1 << 8,
    NEED_PATCH = 1 << 9,
    DYNAMIC_SLOTS = 1 << 10,
    DEV_ROOT_FRAGMENT = 1 << 11,
    CACHED = -1,
    BAIL = -2,
}

export const PatchFlagNames: Record<PatchFlags, string> = {
    [PatchFlags.TEXT]: 'TEXT',
    [PatchFlags.PROPS]: 'PROPS',
    [PatchFlags.FULL_PROPS]: 'FULL_PROPS',
    [PatchFlags.STABLE_FRAGMENT]: 'STABLE_FRAGMENT',
    [PatchFlags.KEYED_FRAGMENT]: 'KEYED_FRAGMENT',
    [PatchFlags.UNKEYED_FRAGMENT]: 'UNKEYED_FRAGMENT',
    [PatchFlags.NEED_PATCH]: 'NEED_PATCH',
    [PatchFlags.DYNAMIC_SLOTS]: 'DYNAMIC_SLOTS',
    [PatchFlags.DEV_ROOT_FRAGMENT]: 'DEV_ROOT_FRAGMENT',
    [PatchFlags.CACHED]: 'CACHED',
    [PatchFlags.BAIL]: 'BAIL',
}
