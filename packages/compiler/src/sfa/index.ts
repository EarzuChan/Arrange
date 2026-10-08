// SFA 工具链的正式调用入口，不转导第三方工具或上游兼容 API
export { compileScript } from './compileScript.ts'
export { parse } from './parse.ts'
export { invalidateTypeCache } from './script/resolveType.ts'

export type { SFAScriptCompileOptions } from './compileScript.ts'
export type { SFABlock, SFADescriptor, SFAParseOptions, SFAParseResult, SFAScriptBlock, SFATemplateBlock } from './parse.ts'
