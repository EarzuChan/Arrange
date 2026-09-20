import type { SourceLocation } from './ast.ts'

export interface CompilerError extends SyntaxError {
    code: number | string
    loc?: SourceLocation
}

export interface CoreCompilerError extends CompilerError {
    code: ErrorCodes
}

export function defaultOnError(error: CompilerError): never {
    throw error
}

export function defaultOnWarn(msg: CompilerError): void {
    __DEV__ && console.warn(`[Arrange 警告] ${msg.message}`)
}

type InferCompilerError<T> = T extends ErrorCodes ? CoreCompilerError : CompilerError

export function createCompilerError<T extends number>(code: T, loc?: SourceLocation, messages?: { [code: number]: string }, additionalMessage?: string,): InferCompilerError<T> {
    const msg = (messages || errorMessages)[code] + (additionalMessage || '')
    const error = new SyntaxError(String(msg)) as InferCompilerError<T>
    error.code = code
    error.loc = loc
    return error
}

export enum ErrorCodes {
    CDATA_IN_HTML_CONTENT,
    DUPLICATE_ATTRIBUTE,
    EOF_BEFORE_TAG_NAME,
    EOF_IN_CDATA,
    EOF_IN_COMMENT,
    EOF_IN_TAG,
    MISSING_ATTRIBUTE_VALUE,
    MISSING_END_TAG_NAME,
    UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
    UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
    UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME,
    UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
    UNEXPECTED_SOLIDUS_IN_TAG,
    X_INVALID_END_TAG,
    X_MISSING_END_TAG,
    X_MISSING_INTERPOLATION_END,
    X_MISSING_DIRECTIVE_NAME,
    X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END,
    X_V_IF_NO_EXPRESSION,
    X_V_IF_SAME_KEY,
    X_V_ELSE_NO_ADJACENT_IF,
    X_V_FOR_NO_EXPRESSION,
    X_V_FOR_MALFORMED_EXPRESSION,
    X_V_FOR_TEMPLATE_KEY_PLACEMENT,
    X_V_SLOT_DUPLICATE_SLOT_NAMES,
    X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
    X_INVALID_EXPRESSION,
}

export const errorMessages: Record<ErrorCodes, string> = {
    [ErrorCodes.CDATA_IN_HTML_CONTENT]: '当前模板位置不接受 CDATA',
    [ErrorCodes.DUPLICATE_ATTRIBUTE]: '重复参数',
    [ErrorCodes.EOF_BEFORE_TAG_NAME]: '标签名称前意外结束',
    [ErrorCodes.EOF_IN_CDATA]: 'CDATA 未结束',
    [ErrorCodes.EOF_IN_COMMENT]: '注释未结束',
    [ErrorCodes.EOF_IN_TAG]: '标签未结束',
    [ErrorCodes.MISSING_ATTRIBUTE_VALUE]: '参数缺少值',
    [ErrorCodes.MISSING_END_TAG_NAME]: '缺少结束标签名称',
    [ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME]: '参数名称包含非法字符',
    [ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE]: '未加引号的参数值包含非法字符',
    [ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME]: '参数名称不能以等号开始',
    [ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME]: '标签名称不能以问号开始',
    [ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG]: '标签中的斜线位置无效',
    [ErrorCodes.X_INVALID_END_TAG]: '无效的结束标签',
    [ErrorCodes.X_MISSING_END_TAG]: '缺少结束标签',
    [ErrorCodes.X_MISSING_INTERPOLATION_END]: '插值缺少结束标记',
    [ErrorCodes.X_MISSING_DIRECTIVE_NAME]: '缺少有效的指令名称',
    [ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END]: '动态参数名称缺少结束方括号，名称表达式不能包含空格',
    [ErrorCodes.X_V_IF_NO_EXPRESSION]: 'v-if 或 v-else-if 缺少表达式',
    [ErrorCodes.X_V_IF_SAME_KEY]: '条件分支必须使用不同的 key',
    [ErrorCodes.X_V_ELSE_NO_ADJACENT_IF]: 'v-else 或 v-else-if 前没有相邻条件分支',
    [ErrorCodes.X_V_FOR_NO_EXPRESSION]: 'v-for 缺少表达式',
    [ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION]: 'v-for 表达式无效',
    [ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT]: '列表分组的 key 必须声明在 Template 上',
    [ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES]: '重复的内容入口名称',
    [ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN]: '显式提供 default 内容后不能再提供隐式默认内容',
    [ErrorCodes.X_INVALID_EXPRESSION]: 'TS 表达式解析失败：',
}
