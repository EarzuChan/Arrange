import {resolve} from "node:path"
import {repoRoot, run} from "./common.ts"

await run("cmd.exe", ["/d", "/c", "npm.cmd run build"], {
    cwd: resolve(repoRoot, "demo/ui-src"),
    windowsVerbatimArguments: true,
})
