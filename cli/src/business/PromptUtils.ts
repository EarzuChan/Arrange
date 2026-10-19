import { isCancel, text } from "../terminal/Prompts.ts"
import { ProjectInteractionCancelled as PromptCancelled } from "../feature/project/ProjectInteraction.ts"
import type { PromptContext } from "../terminal/Prompts.ts"
import { isConcreteVersion } from "../util/Semver.ts"

export { ProjectInteractionCancelled as PromptCancelled } from "../feature/project/ProjectInteraction.ts"

export async function requiredText(io: PromptContext, label: string, options: { readonly placeholder?: string, readonly initialValue?: string, readonly validate?: (value: string) => string | undefined } = {}): Promise<string> {
    const value = await text({
        ...io,
        message: label,
        placeholder: options.placeholder,
        initialValue: options.initialValue,
        validate: (input) => {
            const trimmed = input?.trim() ?? ""
            if (trimmed.length === 0) return "此项必填"
            return options.validate?.(trimmed)
        },
    })

    if (isCancel(value)) throw new PromptCancelled()

    return value.trim()
}

export function validateSemver(value: string): string | undefined {
    return isConcreteVersion(value) ? undefined : "请输入有效的 SemVer 版本，例如 0.1.0"
}

const codePattern = /^[A-Za-z0-9]{4}$/
export function validateFourCharCode(value: string): string | undefined {
    return codePattern.test(value) ? undefined : "请输入恰好四个 ASCII 字母或数字"
}
