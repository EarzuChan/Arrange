import { Command, type ParseOptions } from "commander"
import type { OperationHost } from "./OperationHost.ts"

export class ApplicationCommand extends Command {
    constructor(private readonly host: OperationHost) { super() }

    override async parseAsync(argv?: readonly string[], options?: ParseOptions): Promise<this> {
        try { return await super.parseAsync(argv, options) } finally { await this.host.close() }
    }
}
