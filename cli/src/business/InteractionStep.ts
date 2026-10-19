import type { CommandInterface } from './CommandInterface.ts'
import type { PresentationRegion } from '../terminal/Presentation.ts'

// 业务定义步骤范围和结果，异常时保留现场并释放当前交互位置
export async function interactionStep<T>(terminal: CommandInterface, body: (region: PresentationRegion<CommandInterface>) => Promise<T>, summarize: (value: T) => { readonly question: string, readonly answer: string }): Promise<T> {
    const region = terminal.region()
    let value: T
    try { value = await body(region) } catch (error) {
        try { region.complete() } catch (cleanup) { throw new AggregateError([error, cleanup], '交互步骤失败，且呈现收尾失败', { cause: error }) }
        throw error
    }
    region.complete(summarize(value))
    return value
}
