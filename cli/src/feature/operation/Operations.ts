import { AsyncLocalStorage } from "node:async_hooks"
import { OperationHost } from "./OperationHost.ts"
import { canonicalResource, resourceCovers, type Resource } from "./Resource.ts"
import { ResourcePlanChanged } from "../../util/ResourcePlanChanged.ts"

interface Context { readonly resources: readonly Resource[] }

export class Operations {
    private readonly context = new AsyncLocalStorage<Context>()

    constructor(private readonly host: OperationHost, private readonly signal: AbortSignal, private readonly waiting: (message: string) => void) { }

    async assert(resources: readonly Resource[]): Promise<void> {
        const current = this.context.getStore()
        if (!current) throw new Error("资源检查必须在操作上下文中执行")
        const requested = await Promise.all(resources.map(canonicalResource))
        if (!requested.every(resource => current.resources.some(held => resourceCovers(held, resource)))) throw new ResourcePlanChanged()
    }

    async run<T>(resources: readonly Resource[], label: string, body: () => Promise<T>, observe = false, onWaiting?: (message: string | undefined) => void): Promise<T> {
        this.signal.throwIfAborted()
        const requested = await Promise.all(resources.map(canonicalResource))
        const current = this.context.getStore()
        if (current) {
            if (!requested.every(resource => current.resources.some(held => resourceCovers(held, resource)))) throw new Error(`操作 ${label} 申请了未规划的资源，必须在执行前一次申请完整集合`)
            return body()
        }
        let release: (() => Promise<void>) | undefined
        try {
            release = await this.host.acquire(requested, label, this.signal, onWaiting ? message => onWaiting(message) : this.waiting, { observe })
            onWaiting?.(undefined)
            return await this.context.run({ resources: requested }, body)
        } finally {
            onWaiting?.(undefined)
            await release?.()
        }
    }

    // 源码请求不依赖工程资源，单独占用；获取后只申请内容发布锁，禁止反向申请工程资源
    async source<T>(path: string, label: string, body: (signal: AbortSignal) => Promise<T>, onWaiting?: (message: string | undefined) => void): Promise<T> {
        const resource = await canonicalResource({ kind: "source", path, mode: "write" })
        let release: (() => Promise<void>) | undefined
        try {
            release = await this.host.acquire([resource], label, this.signal, onWaiting ? message => onWaiting(message) : this.waiting, { timeoutMs: null })
            onWaiting?.(undefined)
            return await body(this.signal)
        } finally {
            onWaiting?.(undefined)
            await release?.()
        }
    }
}
