import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isJsonObject } from '../../util/Utils.ts'
import { assertFrameworkCompatible, readCliCompatibility } from './FrameworkMamba.ts'
import { readNativeDependencies } from '../source/NativeDependencies.ts'
import { frameworkVersionFileName } from '../../CliMetadata.ts'

export async function assertFrameworkSource(directory: string, version: string): Promise<void> {
    const path = join(directory, frameworkVersionFileName)
    let metadata: unknown
    try { metadata = JSON.parse(await readFile(path, 'utf8')) } catch (error) { throw new Error(`Arrange 源码版本声明缺失或无效：${path}`, { cause: error }) }
    if (!isJsonObject(metadata) || metadata.frameworkVersion !== version) throw new Error(`Arrange 源码声明的 Framework 版本与所选 ${version} 不符：${path}`)
    assertFrameworkCompatible({ version, cliCompatibility: readCliCompatibility(metadata.cliCompatibility) })
    if (typeof metadata.frameworkInternalProtocolCode !== 'number' || !Number.isSafeInteger(metadata.frameworkInternalProtocolCode) || metadata.frameworkInternalProtocolCode <= 0) throw new Error(`Arrange 源码未声明有效的 frameworkInternalProtocolCode：${path}`)
    await readNativeDependencies(directory)
}
