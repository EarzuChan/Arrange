#!/usr/bin/env node
import {main} from "./main.ts"

const result = await main()
process.exit(result.exitCode)

export {main}
export {normalizeViteArgs} from "./vite.ts"
export {readProjectConfig, stringifyConfig, defaultConfig} from "./config.ts"