import { OperationHost } from "../../src/operation/OperationHost.ts"
import { UserDirectories } from "../../src/user/UserDirectories.ts"

const [root, directory, mode] = process.argv.slice(2) as [string, string, string]
const host = new OperationHost(new UserDirectories(root))
await host.acquire([{ kind: "directory", path: directory, mode: "write" }], "夹具持有资源", new AbortController().signal, () => { })
if (mode === "tool") {
    const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('TOOL '+process.pid+' '+child.pid);setInterval(()=>{},1000)`
    const child = host.start({ command: process.execPath, args: ["-e", script], onOutput: bytes => process.stdout.write(bytes) })
    void child.completion.catch(() => { })
    await new Promise<void>(resolve => setTimeout(resolve, 200))
}
process.stdout.write("READY\n")
setInterval(() => { }, 1000)
