import * as core from '@arrange/framework'
import * as foundation from '@arrange/framework/foundation'
import * as ui from '@arrange/framework/ui'
import * as animation from '@arrange/framework/animation'
import * as internal from '@arrange/framework/internal'

const modules: Record<string, unknown> = { '@arrange/framework': core, '@arrange/framework/foundation': foundation, '@arrange/framework/ui': ui, '@arrange/framework/animation': animation, '@arrange/framework/internal': internal }

export function requireSfaModule(name: string): unknown {
    if (!Object.hasOwn(modules, name)) throw new Error(`测试未提供 SFA 依赖：${name}`)

    return modules[name]
}
