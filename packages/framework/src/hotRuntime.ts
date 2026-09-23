// 与 Vite JavaScript HMR 协议对齐，不依赖页面、DOM 或 CSS
export interface HotUpdate {
    type: string
    path: string
    acceptedPath: string
    timestamp: number
    explicitImportRequired?: boolean
    firstInvalidatedBy?: string
}

export interface HotMessage {
    type: string
    updates?: HotUpdate[]
    paths?: string[]
    event?: string
    data?: unknown
}

type Namespace = Record<string, unknown>
type Data = Record<string, unknown>
type Listener = (data: any) => void | Promise<void>
type Acceptance = { deps: string[]; callback: (modules: (Namespace | undefined)[]) => unknown }
type RecordEntry = { callbacks: Acceptance[]; dispose?: Listener; prune?: Listener; listeners: Map<string, Listener[]>; data: Data }

export interface HotTransport {
    readonly session?: string
    send(event: string, data: unknown): void
    reload(): void
    report(error: unknown): void
}

export class HotRuntime {
    readonly records = new Map<string, RecordEntry>()
    private pending: Promise<void> = Promise.resolve()
    private firstInvalidatedBy: string | undefined

    constructor(private transport: HotTransport, private importModule: (url: string) => Promise<Namespace>) { }

    context(owner: string) {
        let record = this.records.get(owner)
        if (!record) this.records.set(owner, record = { callbacks: [], listeners: new Map(), data: {} })
        record.callbacks = []
        record.listeners.clear()
        const current = record
        const accept = (deps?: string | string[] | ((module: Namespace | undefined) => unknown), callback?: (modules: any) => unknown) => {
            if (deps === undefined || typeof deps === 'function') current.callbacks.push({ deps: [owner], callback: modules => deps?.(modules[0]) })
            else if (typeof deps === 'string') current.callbacks.push({ deps: [deps], callback: modules => callback?.(modules[0]) })
            else if (Array.isArray(deps)) current.callbacks.push({ deps, callback: modules => callback?.(modules) })
            else throw new TypeError('无效的 hot.accept 参数')
        }
        return {
            get data() { return current.data },
            accept,
            acceptExports: (_exports: string[], callback?: (module: Namespace | undefined) => unknown) => accept(callback),
            dispose: (callback: Listener) => { current.dispose = callback },
            prune: (callback: Listener) => { current.prune = callback },
            decline: () => { },
            invalidate: (message?: string) => {
                const data = { path: owner, message, firstInvalidatedBy: this.firstInvalidatedBy ?? owner }
                void this.notify('vite:invalidate', data)
                this.transport.send('vite:invalidate', data)
            },
            on: (event: string, callback: Listener) => {
                const listeners = current.listeners.get(event) ?? []
                listeners.push(callback)
                current.listeners.set(event, listeners)
            },
            off: (event: string, callback: Listener) => {
                const listeners = current.listeners.get(event)
                if (listeners) current.listeners.set(event, listeners.filter(listener => listener !== callback))
            },
            send: (event: string, data?: unknown) => this.transport.send(event, data),
        }
    }

    receive(message: HotMessage): Promise<void> {
        this.pending = this.pending.then(() => this.apply(message)).catch(error => this.transport.report(error))
        return this.pending
    }

    private async notify(event: string, data: unknown): Promise<void> {
        const callbacks = [...this.records.values()].flatMap(record => record.listeners.get(event) ?? [])
        await Promise.allSettled(callbacks.map(callback => callback(data)))
    }

    private async apply(message: HotMessage): Promise<void> {
        if (message.type === 'custom') await this.notify(message.event!, message.data)
        else if (message.type === 'full-reload') {
            await this.notify('vite:beforeFullReload', message)
            this.transport.reload()
        } else if (message.type === 'prune') {
            await this.notify('vite:beforePrune', message)
            for (const path of message.paths ?? []) {
                const record = this.records.get(path)
                await record?.dispose?.(record.data)
                await record?.prune?.(record.data)
                // 同 Vite：hot.data 保留，资源由 dispose/prune 负责释放
            }
        } else if (message.type === 'update') {
            await this.notify('vite:beforeUpdate', message)
            const updates = (message.updates ?? []).filter(update => update.type === 'js-update')
            // 先保存全部旧边界，避免新模块注册覆盖同批 accept 回调
            const boundaries = updates.map(update => ({ update, callbacks: this.records.get(update.path)?.callbacks.filter(callback => callback.deps.includes(update.acceptedPath)) ?? [] }))
            const modules = new Map<string, Namespace>()
            const attempted = new Set<string>()
            for (const { update, callbacks } of boundaries) {
                if (!callbacks.length || attempted.has(update.acceptedPath)) continue
                attempted.add(update.acceptedPath)
                const old = this.records.get(update.acceptedPath)
                const saved = old && { ...old, callbacks: [...old.callbacks], listeners: new Map(old.listeners) }
                await old?.dispose?.(old.data)
                const url = update.acceptedPath + (update.acceptedPath.includes('?') ? '&' : '?') + `t=${update.timestamp}` + (update.explicitImportRequired ? '&import' : '')
                try {
                    modules.set(update.acceptedPath, await this.importModule(url))
                } catch (error) {
                    if (saved && old) Object.assign(old, saved)
                    else this.records.delete(update.acceptedPath)
                    this.transport.report(error)
                }
            }
            for (const { update, callbacks } of boundaries) {
                this.firstInvalidatedBy = update.firstInvalidatedBy || undefined
                try {
                    for (const callback of callbacks) await callback.callback(callback.deps.map(dep => dep === update.acceptedPath ? modules.get(dep) : undefined))
                } finally {
                    this.firstInvalidatedBy = undefined
                }
            }
            await this.notify('vite:afterUpdate', message)
        }
    }
}

declare global {
    var __ARRANGE_HOT_TRANSPORT__: HotTransport | undefined
    var __ARRANGE_HOT_RECEIVE__: ((message: HotMessage) => Promise<void>) | undefined
}

let runtime: HotRuntime | undefined
const imports = new Map<number, { resolve: (module: Namespace) => void; reject: (error: unknown) => void; url: string }>()
let nextImport = 1

function ensureRuntime(): HotRuntime {
    if (runtime) return runtime
    const transport = globalThis.__ARRANGE_HOT_TRANSPORT__
    if (!transport) throw new Error('Arrange live HMR transport 尚未安装')
    runtime = new HotRuntime(transport, url => import(/* @vite-ignore */ url))
    globalThis.__ARRANGE_HOT_RECEIVE__ = async message => {
        if (message.type === 'custom' && message.event === 'arrange:import-ready') {
            const data = message.data as { id: number; error?: string }
            const pending = imports.get(data.id)
            if (!pending) return
            imports.delete(data.id)
            if (data.error) pending.reject(new Error(data.error))
            else import(/* @vite-ignore */ pending.url).then(pending.resolve, pending.reject)
            return
        }
        await runtime!.receive(message)
    }
    return runtime
}

export function createHotContext(owner: string) {
    return ensureRuntime().context(owner)
}

// 网络取图完成后才调用 QuickJS 原生 import，link/evaluate 仍由引擎负责
export function importLiveModule(specifier: unknown, importer: string): Promise<Namespace> {
    ensureRuntime()
    return new Promise((resolve, reject) => {
        const name = String(specifier)
        if (!name.startsWith('/') && !name.startsWith('.')) throw new TypeError(`未解析的动态 ESM specifier：${name}`)
        const joined = name.startsWith('/') ? name : importer.split(/[?#]/)[0].slice(0, importer.split(/[?#]/)[0].lastIndexOf('/') + 1) + name
        const suffix = joined.search(/[?#]/)
        const path = suffix < 0 ? joined : joined.slice(0, suffix)
        const segments: string[] = []
        for (const segment of path.split('/')) {
            if (segment === '..') segments.pop()
            else if (segment && segment !== '.') segments.push(segment)
        }
        const url = '/' + segments.join('/') + (suffix < 0 ? '' : joined.slice(suffix))
        const id = nextImport++
        imports.set(id, { resolve, reject, url })
        const transport = globalThis.__ARRANGE_HOT_TRANSPORT__!
        transport.send('arrange:import', { id, url, session: transport.session })
    })
}

export function injectQuery(url: string, query: string): string {
    const hash = url.indexOf('#')
    const suffix = hash < 0 ? '' : url.slice(hash)
    const path = hash < 0 ? url : url.slice(0, hash)
    return path + (path.includes('?') ? '&' : '?') + query + suffix
}
