import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { SourceCache } from "../../src/source/SourceCache.ts"
import { UserDirectories } from "../../src/user/UserDirectories.ts"
import { testTask, write } from "../fixture.ts"

const [root, counter] = process.argv.slice(2) as [string, string]
const commit = "a".repeat(40)
const cache = new SourceCache(new UserDirectories(root), {
    verify: async () => { }, checkout: async (_spec, directory, _task, signal) => {
        await appendFile(counter, `${process.pid}\n`)
        await delay(300, undefined, { signal })
        await write(join(directory, "CMakeLists.txt"), "project(Fixture NONE)\n")
        await write(join(directory, ".git", "HEAD"), `${commit}\n`)
        return commit
    }
}, new AbortController().signal)
const source = await cache.ensure({ repository: "fixture", ref: "v1", commit }, "Fixture", testTask())
process.stdout.write(`${JSON.stringify(source)}\n`)
