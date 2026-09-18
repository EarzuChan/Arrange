// 编译器和宿主适配共用的输入词汇；值校验与失效归属原生类型化输入
const common = ['modifier', 'enabled', 'contentDescription', 'label', 'description', 'role'] as const
const text = ['text', 'textStyle', 'singleLine', 'minLines', 'maxLines', 'textAlign', 'overflow'] as const

export const hostSchema = {
    Box: [...common, 'contentAlignment'],
    Row: [...common, 'horizontalArrangement', 'verticalAlignment'],
    Column: [...common, 'verticalArrangement', 'horizontalAlignment'],
    Spacer: common,
    Text: [...common, ...text],
    Input: [...common, 'textStyle', 'singleLine', 'minLines', 'maxLines', 'modelValue', 'value', 'placeholder', 'selectAllOnFocus', 'onUpdate:modelValue', 'onUpdate:model-value', 'onSubmit', 'onChange', 'onBlur'],
    Image: [...common, 'source', 'contentScale', 'alignment', 'alpha'],
    Icon: [...common, 'source', 'size', 'tint'],
} as const

export type HostTag = keyof typeof hostSchema

export function isHostTag(tag: string): tag is HostTag {
    return Object.prototype.hasOwnProperty.call(hostSchema, tag)
}

export function canonicalHostInput(name: string): string {
    return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

export function acceptsHostInput(tag: HostTag, name: string): boolean {
    return (hostSchema[tag] as readonly string[]).includes(canonicalHostInput(name))
}

export const hostEventNames = new Set(['onUpdate:modelValue', 'onUpdate:model-value', 'onSubmit', 'onChange', 'onBlur'])

// 组件配置由编译器与运行时共用，内部标记也必须有明确消费者
export const componentOptionNames = new Set(['setup', 'render', 'props', 'emits', 'slots', 'name', 'inheritAttrs', 'components', 'directives', '__name', '__file', '__hmrId', '__asyncLoader', '__asyncResolved', '__isKeepAlive'])
export const defineOptionsNames = new Set(['name', 'inheritAttrs', 'components', 'directives'])
