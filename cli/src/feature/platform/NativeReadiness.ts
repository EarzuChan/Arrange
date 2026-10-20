import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// 每次启动使用独立目录和令牌，原生窗口首帧成功后确认，旧文件不能满足本次就绪
export class NativeReadiness {
    private constructor(private readonly directory: string, private readonly token: string) { }

    static async open(): Promise<NativeReadiness> { return new NativeReadiness(await mkdtemp(join(tmpdir(), 'arrange-dev-ready-')), randomUUID()) }

    get environment(): Record<string, string> { return { ARRANGE_DEV_READY_FILE: join(this.directory, 'ready'), ARRANGE_DEV_READY_TOKEN: this.token } }

    async wait(signal: AbortSignal): Promise<void> {
        while (true) {
            signal.throwIfAborted()
            try {
                if ((await readFile(this.environment.ARRANGE_DEV_READY_FILE!, 'utf8')) === this.token) return
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
            await delay(50, undefined, { signal })
        }
    }

    async close(): Promise<void> { await rm(this.directory, { recursive: true, force: true }) }
}
