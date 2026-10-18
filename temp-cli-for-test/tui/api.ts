export interface Choice<Value extends string = string> { readonly value: Value, readonly label: string }
export interface TaskDefinition { readonly id: string, readonly title: string, readonly console?: boolean }
export interface TaskPresentation { start(): void, progress(value: number): void, append(lines: readonly string[]): void, complete(): void }
export interface TaskGroup { task(id: string): TaskPresentation, complete(): void }

// 业务只表达交互意图和过程事实，不接收终端事件、坐标或渲染状态
export interface CommandUi {
    heading(text: string): void
    message(text: string): void
    select<Value extends string>(question: string, options: readonly Choice<Value>[]): Promise<Value>
    text(question: string, options?: { placeholder?: string, defaultValue?: string }): Promise<string>
    multiselect<Value extends string>(question: string, options: readonly Choice<Value>[], initial?: readonly Value[]): Promise<Value[]>
    tasks(title: string, definitions: readonly TaskDefinition[]): TaskGroup
    result(text: string): void
}

export type Command = (ui: CommandUi, signal: AbortSignal) => Promise<void>
