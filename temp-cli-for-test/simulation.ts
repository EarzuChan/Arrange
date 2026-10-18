import { setTimeout as delay } from 'node:timers/promises'

// 模拟服务只接收业务输入和取消信号，不依赖任何 TUI 类型
export const modules = [
    { id: 'ui', title: '安装 UI 依赖 · pnpm install', output: Array.from({ length: 24 }, (_, index) => `Progress: resolved ${index + 1}, reused ${index}, downloaded 0, added 0`) },
    { id: 'native-debug', title: '配置 native · debug · cmake', output: Array.from({ length: 20 }, (_, index) => `-- Performing Test COMPILER_SUPPORTS_feature_${index + 1} - Success`) },
    { id: 'native-release', title: '配置 native · release · cmake', output: Array.from({ length: 19 }, (_, index) => `-- Generating release target component_${index + 1} - Done`) },
]

export interface WorkEvent { id: string, state: 'pending' | 'running' | 'done', progress: number, lines: string[] }

export function preparationAt(selected: readonly string[], elapsed: number): WorkEvent[] {
    const definitions = [{ id: 'check', output: [] as string[] }, ...modules.filter(module => selected.includes(module.id))]
    return definitions.map((definition, index) => {
        const duration = definition.id === 'check' ? 1700 : 4800
        const progress = Math.max(0, Math.min(1, (elapsed - index * 850) / duration))
        return { id: definition.id, state: elapsed < index * 850 ? 'pending' : progress < 1 ? 'running' : 'done', progress, lines: definition.output.slice(0, Math.floor(definition.output.length * progress)) }
    })
}

export async function* prepare(selected: readonly string[], signal: AbortSignal): AsyncGenerator<WorkEvent[]> {
    const started = Date.now()
    while (true) {
        signal.throwIfAborted()
        const events = preparationAt(selected, Date.now() - started)
        yield events
        if (events.every(event => event.state === 'done')) return
        await delay(160, undefined, { signal })
    }
}
