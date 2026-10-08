import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { type TestContext } from 'node:test'
import { createServer, type ViteDevServer } from 'vite'
import arrange from '../../packages/vite-plugin/src/plugin.ts'

interface ServerMessage { type: string, path?: string }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

async function connect(server: ViteDevServer, messages: ServerMessage[]): Promise<WebSocket> {
    const address = server.httpServer!.address()
    assert.ok(address && typeof address !== 'string')
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, 'vite-hmr')
    socket.addEventListener('message', event => messages.push(JSON.parse(String(event.data))))
    await Promise.race([
        new Promise<void>((resolve, reject) => {
            socket.addEventListener('open', () => resolve(), { once: true })
            socket.addEventListener('error', reject, { once: true })
        }),
        delay(3000).then(() => { throw new Error('Vite WebSocket 未连接') })
    ])
    return socket
}

async function fixture(t: TestContext, publicDir: string | false = 'public') {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arrange-public-resource-')))
    const assets = join(root, publicDir || 'public')
    await mkdir(assets, { recursive: true })
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/main.ts'), 'export const value = 1\n')
    const png = await readFile(resolve('demo/ui-src/public/logo.png'))
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'
    await writeFile(join(assets, 'logo.png'), png)
    await writeFile(join(assets, 'play.svg'), svg)
    const plugin = arrange({ port: 0, strictPort: false })
    const server = await createServer({ root, configFile: false, publicDir, plugins: [plugin], logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false } })
    const messages: ServerMessage[] = []
    const sockets: WebSocket[] = []
    t.after(async () => {
        for (const socket of sockets) socket.close()
        await server.close()
        await rm(root, { recursive: true, force: true })
    })
    await server.listen()
    sockets.push(await connect(server, messages))
    const get = async (url: string) => {
        const address = server.httpServer!.address()
        assert.ok(address && typeof address !== 'string')
        return fetch(`http://127.0.0.1:${address.port}${url}`)
    }
    return { root, assets, server, messages, sockets, plugin, get, png, svg }
}

async function waitForReload(messages: ServerMessage[], from: number): Promise<void> {
    const deadline = Date.now() + 3000
    while (!messages.slice(from).some(message => message.type === 'full-reload') && Date.now() < deadline) await delay(20)
    await delay(150)
    const reloads = messages.slice(from).filter(message => message.type === 'full-reload')
    assert.ok(reloads.length)
    for (const reload of reloads) assert.deepEqual(reload, { type: 'full-reload', path: '*' })
}

test('真实 Vite 对 public PNG/SVG 变动发送标准重载并立即提供新字节', { timeout: 15000 }, async t => {
    const value = await fixture(t)
    const first = await value.get('/logo.png')
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('content-type'), 'image/png')
    assert.equal(first.headers.get('cache-control'), 'no-cache')
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), value.png)

    let from = value.messages.length
    const changedPng = Buffer.concat([value.png, Buffer.from('PNG 资源变更')])
    await writeFile(join(value.assets, 'logo.png'), changedPng)
    await waitForReload(value.messages, from)
    assert.deepEqual(Buffer.from(await (await value.get('/logo.png')).arrayBuffer()), changedPng)

    from = value.messages.length
    const changedSvg = value.svg.replace('M0 0h10v10z', 'M0 0h5v5z')
    await writeFile(join(value.assets, 'play.svg'), changedSvg)
    await waitForReload(value.messages, from)
    const svg = await value.get('/play.svg')
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml')
    assert.equal(await svg.text(), changedSvg)

    from = value.messages.length
    await writeFile(join(value.assets, 'new.svg'), changedSvg)
    await waitForReload(value.messages, from)
    assert.equal((await value.get('/new.svg')).status, 200)

    from = value.messages.length
    await rm(join(value.assets, 'new.svg'))
    await waitForReload(value.messages, from)
    assert.equal((await value.get('/new.svg')).status, 404)
})

test('真实 Vite 使用自定义 publicDir 并忽略同名前缀的兄弟目录', { timeout: 15000 }, async t => {
    const value = await fixture(t, 'static/images')
    const sibling = join(value.root, 'static/images-other')
    await mkdir(sibling)
    await writeFile(join(sibling, 'logo.png'), value.png)
    await delay(150)
    const from = value.messages.length
    await writeFile(join(sibling, 'logo.png'), Buffer.concat([value.png, Buffer.from('兄弟目录')]))
    await delay(200)
    assert.equal(value.messages.slice(from).some(message => message.type === 'full-reload'), false)

    await writeFile(join(value.assets, 'play.svg'), value.svg + '\n')
    await waitForReload(value.messages, from)
    assert.equal(await (await value.get('/play.svg')).text(), value.svg + '\n')
})

test('真实 Vite 的 publicDir false 不安装资源重载，close 移除监听', { timeout: 15000 }, async t => {
    const disabled = await fixture(t, false)
    let from = disabled.messages.length
    await writeFile(join(disabled.assets, 'play.svg'), disabled.svg + '\n')
    await delay(200)
    assert.equal(disabled.messages.slice(from).some(message => message.type === 'full-reload'), false)

    const enabled = await fixture(t)
    const watcher = enabled.server.watcher
    await enabled.server.close()
    assert.deepEqual(['change', 'add', 'unlink'].map(event => watcher.listenerCount(event)), [0, 0, 0])
})

test('真实 Vite restart 后资源重载只保留当前服务监听', { timeout: 15000 }, async t => {
    const value = await fixture(t)
    const previousWatcher = value.server.watcher
    await value.server.restart()
    assert.notEqual(value.server.watcher, previousWatcher)
    assert.equal(previousWatcher.listenerCount('change'), 0)
    value.sockets.push(await connect(value.server, value.messages))
    const from = value.messages.length
    await writeFile(join(value.assets, 'play.svg'), value.svg + '\n')
    await waitForReload(value.messages, from)
    await delay(150)
    assert.equal(value.messages.slice(from).filter(message => message.type === 'full-reload').length, 1)
})
