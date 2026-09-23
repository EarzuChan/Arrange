import { transformWithOxc } from "vite"
import { compileArrangeSfa, isSfaModule, isSfaQueryModule } from "./sfa.ts"
import type { ArrangeTransformPlugin, ArrangeTransformPluginOptions, TransformThis } from "./types.ts"

export function createArrangeTransformPlugin(options: ArrangeTransformPluginOptions): ArrangeTransformPlugin {
    return {
        name: options.name,
        enforce: "pre",
        load(id: string): string | null {
            if (!isSfaQueryModule(id)) return null
            return ""
        },
        transform(this: TransformThis, code: string, id: string) {
            if (!isSfaModule(id)) return null
            if (String(id).includes("?")) return ""

            const { code: transformed, warnings, map, dependencies } = compileArrangeSfa(code, id, options.hot())
            for (const message of warnings) this.warn({ id, message })
            for (const dependency of dependencies) this.addWatchFile?.(dependency)

            return transformWithOxc(transformed, id, {
                lang: "ts",
                target: "es2022",
                sourcemap: true,
            }, map).then(result => ({ code: result.code, map: result.map }))
        },
    }
}
