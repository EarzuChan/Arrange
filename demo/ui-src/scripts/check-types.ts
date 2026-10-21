import { fileURLToPath } from 'node:url'
import { checkSfaProject } from '@arrange/framework/vite'

const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))
const diagnostics = checkSfaProject(configPath, [sourceRoot])
for (const diagnostic of diagnostics) console.error('[ArrangeTypecheck]', `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}：${diagnostic.message}`)
if (diagnostics.length) process.exitCode = 1
else console.log('[ArrangeTypecheck]', 'SFA 脚本与模板类型检查通过')
