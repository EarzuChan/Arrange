import type { TestEvent } from "node:test/reporters"

export default async function* report(events: AsyncIterable<TestEvent>) {
    const excluded: { name: string, reason: string }[] = []
    const failures: string[] = []
    const unverified: { name: string, reason: string }[] = []
    let summary: unknown
    for await (const event of events) {
        if (event.type === "test:pass" && event.data.skip) {
            const item = { name: event.data.name, reason: String(event.data.skip) }
            if (item.reason.startsWith("不适用：")) excluded.push(item)
            else unverified.push(item)
        }
        if (event.type === "test:fail") failures.push(event.data.name)
        if (event.type === "test:summary") summary = event.data
    }
    yield `${JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version, excluded, unverified, failures, summary }, null, 4)}\n`
    if (unverified.length) throw new Error(`本机测试存在未验证项：${unverified.map(item => `${item.name}（${item.reason}）`).join("；")}`)
}
