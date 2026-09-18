import MagicString from 'magic-string'
import type { SFCScriptBlock } from '../parse.ts'
import { rewriteDefaultAST } from '../rewriteDefault.ts'
import { analyzeScriptBindings } from './analyzeScriptBindings.ts'
import type { ScriptCompileContext } from './context.ts'

export const normalScriptDefaultVar = `__default__`

export function processNormalScript(ctx: ScriptCompileContext): SFCScriptBlock {
    const script = ctx.descriptor.script!
    try {
        let content = script.content
        let map = script.map
        const scriptAst = ctx.scriptAst!
        const bindings = analyzeScriptBindings(scriptAst.body, ctx)
        const { genDefaultAs, isProd } = ctx.options

        if (genDefaultAs) {
            const defaultVar = genDefaultAs || normalScriptDefaultVar
            const s = new MagicString(content)
            rewriteDefaultAST(scriptAst.body, s, defaultVar)
            content = s.toString()
            if (!genDefaultAs) {
                content += `\nexport default ${defaultVar}`
            }
        }
        return {
            ...script,
            content,
            map,
            bindings,
            scriptAst: scriptAst.body,
        }
    } catch (error) {
        throw error
    }
}
