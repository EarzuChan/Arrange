import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { z } from "zod"
import { sourceReferencesFileName, sourceReferencesSchema } from "../CliMetadata.ts"
import { writeAtomicText } from "../util/AtomicFile.ts"

export const buildReferencesSchema = z.object({ schema: z.literal(sourceReferencesSchema), directories: z.array(z.string()) })
const sourceKey = (key: string): boolean => key.startsWith("FETCHCONTENT_SOURCE_DIR_") || key === "JUCE_DIR" || key === "ARRANGE_QUICKJS_NG_SOURCE_DIR"

export class BuildReferences {
    private readonly path: string
    constructor(directory: string) { this.path = join(directory, sourceReferencesFileName) }

    async begin(definitions: Readonly<Record<string, string>>, root: string): Promise<() => Promise<void>> {
        const current = [...new Set(Object.entries(definitions).filter(([key, value]) => sourceKey(key) && value).map(([, value]) => resolve(root, value)))].sort()
        let previous: readonly string[] = []
        try { previous = buildReferencesSchema.parse(JSON.parse(await readFile(this.path, "utf8"))).directories } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`源码引用记录损坏：${this.path}`, { cause: error })
        }
        const save = (directories: readonly string[]) => writeAtomicText(this.path, `${JSON.stringify({ schema: sourceReferencesSchema, directories }, null, 4)}\n`)
        await save([...new Set([...previous, ...current])].sort())
        return () => save(current)
    }
}
