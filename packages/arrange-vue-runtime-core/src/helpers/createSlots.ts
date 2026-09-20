import { contentBranchKey } from '../contentScope.ts'
import type { Slot } from '../arrangableSlots.ts'

interface ContentDescriptor {
    name: string
    fn: Slot
    key?: PropertyKey
}

// 条件内容的身份来自编译器分支；重复提供同一入口一律拒绝
export function createSlots(slots: Record<string, Slot>, branches: (ContentDescriptor | ContentDescriptor[] | undefined)[]): Record<string, Slot> {
    for (const branch of branches) {
        for (const entry of Array.isArray(branch) ? branch : branch ? [branch] : []) {
            if (Object.prototype.hasOwnProperty.call(slots, entry.name)) throw new TypeError(`重复内容入口：${entry.name}`)
            if (entry.key !== undefined) entry.fn[contentBranchKey] = entry.key
            slots[entry.name] = entry.fn
        }
    }
    return slots
}
