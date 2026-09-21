import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const write = process.argv.includes('--write')
const files = execFileSync('rg', ['--files', 'native', 'cpp_tests', 'demo', '-g', '*.cpp', '-g', '*.h', '-g', '*.hpp'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/)
const formatter = process.env.CLANG_FORMAT ?? 'clang-format'

execFileSync(formatter, ['--style=file', ...(write ? ['-i'] : ['--dry-run', '--Werror']), ...files], { cwd: root, stdio: 'inherit' })
console.log(`${write ? '已修正' : '已检查'} ${files.length} 个 C++ 文件`)
