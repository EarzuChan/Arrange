import { Command, type ParseOptions } from "commander"
import type { OperationHost } from "../feature/operation/OperationHost.ts"
import { errorMessage } from "../util/Utils.ts"

export class ApplicationCommand extends Command {
    constructor(private readonly host: Pick<OperationHost, 'close'>, name?: string, private readonly outcome = { code: 0 }) { super(name) }

    get resultCode(): number { return this.outcome.code }

    override createCommand(name?: string): ApplicationCommand { return new ApplicationCommand(this.host, name, this.outcome) }

    // Commander 忽略 action 返回值，这里将语义结果收集到本次命令调用
    override action(handler: (this: this, ...args: any[]) => number | void | Promise<number | void>): this {
        return super.action(async (...args: any[]) => {
            const code = await handler.apply(this, args)
            if (code !== undefined) this.outcome.code = code
        })
    }

    override async parseAsync(argv?: readonly string[], options?: ParseOptions): Promise<this> {
        this.outcome.code = 0
        let failure: unknown

        try {
            return await super.parseAsync(argv, options)
        } catch (error) {
            failure = error
            throw error
        } finally {
            try {
                await this.host.close()
            } catch (cleanup) {
                if (failure !== undefined) throw new AggregateError([failure, cleanup], errorMessage(failure) + '；资源收尾失败：' + errorMessage(cleanup))
                throw cleanup
            }
        }
    }
}
