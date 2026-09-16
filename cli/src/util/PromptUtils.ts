import { cancel, isCancel, text } from "@clack/prompts"

export class PromptCancelled extends Error {}

export async function requiredText(label: string, options: {
    readonly placeholder?: string
    readonly initialValue?: string
    readonly validate?: (value: string) => string | undefined
} = {}): Promise<string> {
    const value = await text({
        message: label,
        placeholder: options.placeholder,
        initialValue: options.initialValue,
        validate: (input) => {
            const trimmed = input?.trim() ?? ""
            if (trimmed.length === 0) return "Required."
            return options.validate?.(trimmed)
        },
    })
    if (isCancel(value)) throw new PromptCancelled()

    return value.trim()
}

export function validateSemver(value: string): string | undefined {
    return semverPattern.test(value) ? undefined : "Enter a valid semver version, for example 0.1.0."
}

export function validateFourCharCode(value: string): string | undefined {
    return codePattern.test(value) ? undefined : "Enter exactly four ASCII letters or digits."
}

const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const codePattern = /^[A-Za-z0-9]{4}$/
