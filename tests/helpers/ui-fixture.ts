import { cp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../..', import.meta.url))

export async function prepareUiFixture(root: string): Promise<void> {
    await mkdir(root, { recursive: true })
    for (const name of ['src', 'public']) await cp(resolve(repository, 'demo/ui-src', name), resolve(root, name), { recursive: true })
    await mkdir(resolve(root, 'node_modules/@arrange'), { recursive: true })
    await symlink(resolve(repository, 'packages/framework'), resolve(root, 'node_modules/@arrange/framework'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
}

export async function prepareRuntimeFixtureWorkspace(root: string): Promise<void> {
    const gallery = resolve(root, 'demo/ui-src')
    await prepareUiFixture(gallery)
    await symlink(resolve(gallery, 'node_modules'), resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    await cp(resolve(repository, 'tests/fixtures'), resolve(root, 'tests/fixtures'), { recursive: true })
    await writeFile(resolve(root, 'tsconfig.json'), JSON.stringify({ extends: resolve(repository, 'tsconfig.json'), include: ['demo/ui-src/src/**/*.ts', 'tests/fixtures/**/*.ts'] }))
}
