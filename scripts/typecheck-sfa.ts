import { resolve } from 'node:path'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { checkSfaProject } from '../packages/vite-plugin/src/typecheck.ts'
import { prepareRuntimeFixtureWorkspace } from '../tests/helpers/ui-fixture.ts'

const roots = process.argv.slice(2)
const workspace = roots.length ? undefined : await realpath(await mkdtemp(resolve(tmpdir(), 'arrange-sfa-typecheck-')))
let diagnostics
try {
    if (workspace) await prepareRuntimeFixtureWorkspace(workspace)
    diagnostics = checkSfaProject(resolve(workspace ?? '.', 'tsconfig.json'), roots.length ? roots : ['demo/ui-src/src', 'tests/fixtures/rearrange-runtime', 'tests/fixtures/viewport-runtime'].map(path => resolve(workspace!, path)))
} finally {
    if (workspace) await rm(workspace, { recursive: true, force: true })
}
for (const diagnostic of diagnostics) console.error('[ArrangeSfaTypecheck]', `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}：${diagnostic.message}`)
if (diagnostics.length) process.exitCode = 1
else console.log('[ArrangeSfaTypecheck]', 'SFA 脚本与模板类型检查通过')
