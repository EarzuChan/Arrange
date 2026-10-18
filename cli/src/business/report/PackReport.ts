import { stat } from "node:fs/promises"
import { isAbsolute, relative } from "node:path"
import type { BuildFlavor, ProjectState } from "../../feature/project/ProjectState.ts"
import { padEnd, visibleWidth } from "../../util/TerminalText.ts"
import { formatFileSize } from "../../util/FileSize.ts"
import type { PackResult } from "../../feature/packing/Packer.ts"

function displayPath(rootDir: string, path: string): string {
    const shown = relative(rootDir, path)
    return shown === "" || shown.startsWith("..") || isAbsolute(shown) ? path : shown
}

// 打包结果：首行为交付目录，其后每个产品一行（位置与二进制大小），最后是清单；路径相对工程根
export async function describePackResult(state: ProjectState, flavor: BuildFlavor, result: PackResult): Promise<string[]> {
    const manifestLabel = "清单"
    const width = Math.max(visibleWidth(manifestLabel), ...result.products.map(product => visibleWidth(product.product)))
    const lines = [`交付物（${flavor} · ${state.project.project.version}）：${displayPath(state.rootDir, result.directory)}`]
    for (const product of result.products) {
        const size = await stat(product.binaryPath).then(info => `，二进制 ${formatFileSize(info.size)}`, () => "")
        lines.push(`${padEnd(product.product, width)}  ${displayPath(state.rootDir, product.path)}${size}`)
    }
    lines.push(`${padEnd(manifestLabel, width)}  ${displayPath(state.rootDir, result.manifestPath)}`)
    return lines
}
