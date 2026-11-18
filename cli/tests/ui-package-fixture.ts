import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { write } from './fixture.ts'

export async function writeUiManifest(directory: string, framework: string, assets: string[] = []) {
    const entries = await Promise.all(['app.js', ...assets].map(async (path, index) => {
        const bytes = await readFile(join(directory, path))
        return { path, kind: index ? 'asset' : 'module', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    await write(join(directory, 'arrange-ui.json'), JSON.stringify({ format: 2, scriptFormat: 'js', framework, protocol: 12, entry: 'app.js', entries }))
}
