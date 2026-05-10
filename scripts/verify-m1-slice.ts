import {run} from "./common.ts"

await run("node", ["--test", "tests/**/*.test.ts"])
await run("node", ["scripts/test-native.ts"])
await run("node", ["scripts/test-quickjs-app.ts"])
