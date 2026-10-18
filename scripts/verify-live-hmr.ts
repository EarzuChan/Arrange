import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import arrange from '../packages/vite-plugin/src/plugin.ts'
import { configureSmokeBuild, nativeCmake, nativeExecutable, nativeTestDirectory } from './native-toolchain.ts'
import { withNativeSession, nativeSessionStart } from "./native-session.ts"
import type { RunningProcess, ProcessResult } from "../cli/src/feature/platform/ProcessSpec.ts"

await withNativeSession(async () => {


    const build = nativeTestDirectory()
    const requestedExecutable = process.argv.slice(2).find(argument => !argument.startsWith("--"))
    if (!requestedExecutable) {
        await configureSmokeBuild(build)
        await nativeCmake(['--build', build, '--target', 'arrange_live_server', '--parallel', '4'])
    }
    const executable = requestedExecutable ? resolve(requestedExecutable) : nativeExecutable(resolve(build, 'cpp_tests'), 'arrange_live_server')
    const directory = await mkdtemp(resolve('build/live-hmr-'))
    const server = await createServer({ root: directory, configFile: false, plugins: [arrange({ entry: 'main.ts', port: 0 })], optimizeDeps: { noDiscovery: true }, server: { watch: { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 } } } })
    let child: RunningProcess | undefined
    let completed: ProcessResult | undefined
    let processFailure: unknown
    let output = ''
    let errors = ''
    let cursor = 0

    async function waitFor(text: string): Promise<void> {
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) {
            const found = output.indexOf(text, cursor)
            if (found >= 0) {
                cursor = found + text.length
                return
            }
            if (processFailure) throw processFailure
            if (completed) throw new Error(`native 提前退出：${output}\n${errors}`)
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        throw new Error(`未等到 ${text}：${output}\n${errors}`)
    }

    const module = (value: number, invalidate = false) => `
const hot = import.meta.hot
const previous = hot.data.value ?? 0
export const value = previous + ${value}
hot.dispose(data => { data.value = value })
import.meta.hot.accept(next => { ${invalidate ? "hot.invalidate('向入口传播')" : "hot.send('test:probe', { value: next.value })"} })
`

    try {
        await writeFile(resolve(directory, 'main.ts'), `import {value} from './state.ts'\nconst lazy = await import('./lazy.ts')\nimport.meta.hot.send('test:probe', {value: value + lazy.value})\n`)
        await writeFile(resolve(directory, 'state.ts'), module(1))
        await writeFile(resolve(directory, 'lazy.ts'), 'export const value = await Promise.resolve(10)')
        await server.listen()
        const url = server.resolvedUrls!.local[0]
        child = nativeSessionStart({
            command: executable, args: [url], onOutput: (chunk, channel) => {
                if (channel === "stdout") output += chunk.toString()
                else errors += chunk.toString()
            }
        })
        void child.completion.then(result => { completed = result }, error => { processFailure = error })
        await waitFor('VALUE 11')
        await writeFile(resolve(directory, 'state.ts'), module(2))
        await waitFor('VALUE 3')
        assert.equal(output.split('LOAD').length - 1, 1, '接受更新不应重建 QuickJS context')
        await writeFile(resolve(directory, 'state.ts'), 'export const = broken')
        await waitFor('ERROR')
        await writeFile(resolve(directory, 'state.ts'), module(4, true))
        await waitFor('VALUE 7')
        await writeFile(resolve(directory, 'state.ts'), module(8))
        // 上一个版本的 accept 主动 invalidate，Vite 传播到无 accept 的入口
        await waitFor('VALUE 18')
        assert.equal(output.split('LOAD').length - 1, 2)
        await writeFile(resolve(directory, 'main.ts'), `import.meta.hot.send('test:done', {})`)
        const result = await child.completion
        if (result.exitCode !== 0) throw new Error(`原生进程退出码 ${result.exitCode}：${errors}`)
        console.log('[ArrangeLiveHmrVerify]', '真实 Vite → 后台快照 → QuickJS：动态 import/TLA、dispose/data、同 context accept、编译失败恢复、invalidate/full reload 全部通过')
    } finally {
        await child?.stop()
        await server.close()
        await rm(directory, { recursive: true, force: true })
    }

}, process.argv.slice(2).some(argument => !argument.startsWith("--")) ? [] : [nativeTestDirectory()])
