import { OperationHost } from "../../src/feature/operation/OperationHost.ts"
import { UserDirectories } from "../../src/feature/user/UserDirectories.ts"

const [root, directory, mode] = process.argv.slice(2) as [string, string, string]
const host = new OperationHost(new UserDirectories(root))
await host.acquire([{ kind: "directory", path: directory, mode: "write" }], "夹具持有资源", new AbortController().signal, () => { })
if (mode === "tool") {
    const script = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('TOOL '+process.pid+' '+child.pid);setInterval(()=>{},1000)`
    let ready!: () => void
    const started = new Promise<void>(resolve => { ready = resolve })
    let output = ''
    const child = host.start({
        command: process.execPath, args: ["-e", script], onOutput: bytes => {
            output += bytes.toString()
            process.stdout.write(bytes)
            if (/TOOL \d+ \d+/.test(output)) ready()
        }
    })
    void child.completion.catch(() => { })
    await Promise.race([started, child.completion.then(() => { throw new Error("工具未发布 PID 便退出") })])
}
process.stdout.write("READY\n")
setInterval(() => { }, 1000)
