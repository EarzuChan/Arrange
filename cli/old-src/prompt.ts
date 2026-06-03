import {checkbox, input, select} from "@inquirer/prompts"

export type Choice<T> = {
    name: string
    value: T
    description?: string
    disabled?: string | boolean
    checked?: boolean
}

export async function promptRequiredText(message: string, args: {hint: string; validate?: (value: string) => true | string | Promise<true | string>}): Promise<string> {
    return input({
        message: `${message} (${args.hint})`,
        required: true,
        validate: async (value) => {
            const trimmed = value.trim()
            if (!trimmed) return "This field is required."
            return args.validate ? args.validate(trimmed) : true
        },
        transformer: (value) => value.trim(),
    })
}

export async function promptOptionalText(message: string, args: {defaultValue: string; hint: string; validate?: (value: string) => true | string | Promise<true | string>}): Promise<string> {
    return input({
        message: `${message} (${args.hint})`,
        default: args.defaultValue,
        validate: async (value) => {
            const trimmed = value.trim()
            if (!trimmed) return true
            return args.validate ? args.validate(trimmed) : true
        },
        transformer: (value) => value.trim(),
    })
}

export async function promptSelect<T>(message: string, choices: Array<Choice<T>>): Promise<T> {
    return select({message, choices, loop: false})
}

export async function promptCheckbox<T>(message: string, choices: Array<Choice<T>>, required = true): Promise<T[]> {
    return checkbox({
        message,
        choices,
        required,
        loop: false,
        validate: (values) => required && values.length === 0 ? "Select at least one item." : true,
    })
}

export async function promptExplicitConfirm(message: string): Promise<boolean> {
    return promptSelect(message, [
        {name: "Yes", value: true},
        {name: "No", value: false},
    ])
}
