import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import test from 'node:test'
import { NativeReadiness } from '../src/feature/platform/NativeReadiness.ts'

test('Native 就绪必须回报本次启动令牌，旧令牌不能提前开放运行态', async () => {
    const readiness = await NativeReadiness.open()
    try {
        const file = readiness.environment.ARRANGE_DEV_READY_FILE!
        const token = readiness.environment.ARRANGE_DEV_READY_TOKEN!
        const signal = new AbortController().signal
        await writeFile(file, 'previous-run')
        const waiting = readiness.wait(signal)
        await new Promise(resolve => setTimeout(resolve, 70))
        await writeFile(file, token)
        await waiting
    } finally { await readiness.close() }
})

test('Native 就绪等待响应取消信号且释放临时目录', async () => {
    const readiness = await NativeReadiness.open()
    const controller = new AbortController()
    const waiting = readiness.wait(controller.signal)
    controller.abort(new DOMException('停止等待', 'AbortError'))
    await assert.rejects(waiting, { name: 'AbortError' })
    await readiness.close()
})
