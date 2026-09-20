import { currentInstance } from '../arrangable.ts'

export function useId(): string {
    if (!currentInstance) throw new Error('useId 必须在活动 Arrangable 中调用')
    return `arrange-${currentInstance.uid}-${currentInstance.ids[1]++}`
}
