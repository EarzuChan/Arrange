import {transformWithEsbuild} from "vite"
import {compileArrangeSfc, injectHmrClient, isEntryModule, isVueModule, isVueQueryModule} from "./sfc.ts"
import type {ArrangeTransformPlugin, ArrangeTransformPluginOptions, TransformThis} from "./types.ts"

export function createArrangeTransformPlugin(options: ArrangeTransformPluginOptions): ArrangeTransformPlugin {
    return {
        name: options.name,
        enforce: "pre",
        load(id: string): string | null {
            if (!isVueQueryModule(id)) return null
            return ""
        },
        transform(this: TransformThis, code: string, id: string): string | Promise<string | null> | null {
            if (isEntryModule(id, options.entry)) {
                return options.injectEntryHmrClient() ? injectHmrClient(code) : code
            }
            if (!isVueModule(id)) return null
            if (String(id).includes("?")) return ""

            const {code: transformed, warnings, needsEsbuild} = compileArrangeSfc(code, id)
            for (const message of warnings) this.warn({id, message})
            if (!needsEsbuild) return transformed

            return transformWithEsbuild(transformed, id, {
                loader: "ts",
                target: "es2022",
                sourcemap: false,
            }).then((result) => result.code)
        },
    }
}
