import { relative, resolve, sep } from 'node:path'

// 提示用户切换工作目录，不改变 CLI 或父 shell 的当前目录
export function projectLocationHint(rootDir: string): string {
    let directory = relative(process.cwd(), resolve(rootDir))
    if (!directory) return ''
    if (directory.startsWith('-')) directory = '.' + sep + directory
    const quoted = process.platform === 'win32' ? "'" + directory.replaceAll("'", "''") + "'" : "'" + directory.replaceAll("'", "'\\''") + "'"
    const command = process.platform === 'win32' && /[*?\[\]]/.test(directory) ? 'cd -LiteralPath ' : 'cd '
    return '；先运行 ' + command + quoted + ' 进入工程目录'
}
