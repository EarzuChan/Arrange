import { join } from "node:path"
import { rename } from "node:fs/promises"
import { TransactionStore } from "../../src/transaction/TransactionStore.ts"
import { ReplacementTransaction } from "../../src/transaction/ReplacementTransaction.ts"
import { DeleteTransaction } from "../../src/transaction/DeleteTransaction.ts"
import { OperationHost } from "../../src/operation/OperationHost.ts"
import { Operations } from "../../src/operation/Operations.ts"
import { UserDirectories } from "../../src/user/UserDirectories.ts"

const [root, kind] = process.argv.slice(2) as [string, string]
const host = new OperationHost(new UserDirectories(join(root, "user")))
const operations = new Operations(host, host.failureSignal, () => { })
await operations.run([{ kind: "initialization", path: root, mode: "write" }], "强杀恢复夹具", async () => {
    const store = new TransactionStore(root)
    let id: string
    if (kind === "replace") {
        const transaction = new ReplacementTransaction(store)
        const record = await transaction.prepare([{ root, destination: join(root, "destination"), staged: join(root, "staged"), backup: join(root, "backup") }])
        await rename(join(root, "destination"), join(root, "backup"))
        id = record.id
    } else {
        const record = await new DeleteTransaction(store).prepare([{ root, path: join(root, "destination") }])
        const payload = record.payload as { entries: { quarantine: string }[] }
        await rename(join(root, "destination"), payload.entries[0].quarantine)
        id = record.id
    }
    process.stdout.write(`READY ${id}\n`)
    await new Promise<void>(() => { setInterval(() => { }, 1000) })
})
