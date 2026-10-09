import { lstat } from "node:fs/promises"
import { resolve } from "node:path"
import type { Executor } from "../platform/Executor.ts"
import { throwIfProcessCancelled } from "../platform/ProcessSpec.ts"

// 文件复制不保证保留 Windows 的 shell 属性；在最终暂存目录上恢复 VST3 图标约定
export class WindowsBundleIcon {
    constructor(private readonly executor: Executor) { }

    async prepare(bundle: string): Promise<void> {
        const icon = resolve(bundle, "Plugin.ico")
        const ini = resolve(bundle, "desktop.ini")
        const info = await Promise.all([icon, ini].map(path => lstat(path).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw error
        })))
        if (!info.every(item => item?.isFile())) return
        for (const args of [["+r", bundle], ["+s", "+h", ini], ["+r", "+h", icon]]) {
            const result = await this.executor.run({ command: "attrib", args, cwd: bundle })
            throwIfProcessCancelled(result)
            if (result.exitCode !== 0) throw new Error(`无法设置 Windows VST3 图标属性：${result.stderr || bundle}`)
        }
    }
}
