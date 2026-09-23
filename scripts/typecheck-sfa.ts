import { resolve } from 'node:path'
import { checkSfaProject } from '../packages/vite-plugin/src/typecheck.ts'

const roots = process.argv.slice(2)
const diagnostics = checkSfaProject(resolve('tsconfig.json'), roots.length ? roots : ['demo/ui-src/src', 'tests/fixtures/rearrange-runtime', 'tests/fixtures/viewport-runtime'])
for (const diagnostic of diagnostics) console.error('[ArrangeSfaTypecheck]', `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}：${diagnostic.message}`)
if (diagnostics.length) process.exitCode = 1
else console.log('[ArrangeSfaTypecheck]', 'SFA 脚本与模板类型检查通过')
