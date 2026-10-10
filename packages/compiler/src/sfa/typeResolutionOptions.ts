import type TS from 'typescript'

// SFA 编译期的类型解析（props 类型里导入的类型、模板调用的定义）固定使用 Bundler 模块解析，不随用户 tsconfig 的模块解析设置变化。
// Arrange 自己的包只通过 package.json 的 exports 暴露子路径，Node10 解析（TypeScript 对无配置的默认）不读 exports，会找不到 `@arrange/framework/ui` 之类的导入。
// 用户 tsconfig 的其它选项（paths、baseUrl、customConditions 等）照常生效；没有 tsconfig 时只用这组默认值。
export function sfaTypeResolutionOptions(ts: typeof TS): TS.CompilerOptions {
    return { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true }
}

export function withSfaTypeResolution(ts: typeof TS, options: TS.CompilerOptions = {}): TS.CompilerOptions {
    return { ...options, ...sfaTypeResolutionOptions(ts) }
}
