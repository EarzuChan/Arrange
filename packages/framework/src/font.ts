import { getCurrentScope, onScopeDispose, shallowRef } from '@arrange/reactivity'
import type { NativeBindingHandle, NativeTransactionTarget, ResourceRef } from './native.ts'
import type { PainterCompletion } from './painter.ts'

// 字重是 1 至 1000 的数值，规则同 CSS 的数值字重；常量只是数值的写法便利，不向下传递样式名
export const FontWeight = Object.freeze({
    Thin: 100,
    ExtraLight: 200,
    Light: 300,
    Normal: 400,
    Medium: 500,
    SemiBold: 600,
    Bold: 700,
    ExtraBold: 800,
    Black: 900,
} as const)

export type FontStyle = 'normal' | 'italic'
export type FontFamilyStatus = 'loading' | 'ready' | 'failed' | 'disposed'

export const minFontWeight = 1
export const maxFontWeight = 1000

export type FontFaceDeclaration = Readonly<{
    // 经 Vite import 或 public/ 取得的地址，走与 Painter 相同的资源获取层
    src: ResourceRef
    // 字重与字形的覆盖项；省略时读字体 OS/2 表，只有个别写错 OS/2 的字体需要覆盖
    weight?: number
    style?: FontStyle
}>

export type FontFamilyOptions = Readonly<{
    faces: readonly FontFaceDeclaration[]
    // 声明预加载后首帧等这些字面到齐（原生侧最多等 3 秒）；省略时先用回落字体排版，到达后重排
    preload?: boolean
}>

export interface FontFamily {
    readonly name: string
    readonly status: FontFamilyStatus
    readonly error: string | undefined
    dispose(): void
}

export function isFontWeight(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= minFontWeight && value <= maxFontWeight
}

// 文字样式里的字体字段：fontFamily 接受单个族名或族名数组，归一为数组；非法值抛出，不静默忽略
export function normalizeFontStyle<T extends Readonly<Record<string, unknown>>>(style: T): T {
    const { fontFamily, fontWeight, fontStyle, fontSynthesis } = style
    if (fontFamily === undefined && fontWeight === undefined && fontStyle === undefined && fontSynthesis === undefined) return style
    const result: Record<string, unknown> = { ...style }
    if (fontFamily !== undefined) {
        const list = typeof fontFamily === 'string' ? [fontFamily] : fontFamily
        if (!Array.isArray(list) || list.length > 16 || list.some(name => typeof name !== 'string' || !name.trim() || name.length > 128 || name.includes('\n'))) throw new TypeError('fontFamily 需要非空字符串或不超过 16 个族名的数组')
        result.fontFamily = Object.freeze(list.map(name => name.trim()))
    }
    if (fontWeight !== undefined && !isFontWeight(fontWeight)) throw new RangeError('fontWeight 需要 1 到 1000 的整数')
    if (fontStyle !== undefined && fontStyle !== 'normal' && fontStyle !== 'italic') throw new TypeError("fontStyle 只能是 'normal' 或 'italic'")
    if (fontSynthesis !== undefined && typeof fontSynthesis !== 'boolean') throw new TypeError('fontSynthesis 需要布尔值')
    return Object.freeze(result) as T
}

type Face = Readonly<{
    declaration: FontFaceDeclaration
    handle: NativeBindingHandle
    state: { status: 'loading' | 'ready' | 'failed'; contentVersion: number; error?: string }
}>

// 声明一个自带字体族。字节经现有资源获取层（live 与 dist 同一条链路）加载，到达后登记进原生字体注册表并推进字体环境代际，
// 使用了该族的 Text、Input 与含文字的绘制重新排版；族名与系统字体重名时自带字体优先
export function defineFontFamily(name: string, options: FontFamilyOptions): FontFamily {
    const native: NativeTransactionTarget | undefined = globalThis.__ARRANGE_NATIVE__
    if (!native?.defineFontFamily) throw new Error('defineFontFamily 需要原生运行时')
    if (typeof name !== 'string' || !name.trim() || name.length > 128 || name.includes('\n')) throw new TypeError('字体族名需要非空字符串')
    if (!options || !Array.isArray(options.faces) || options.faces.length === 0 || options.faces.length > 64) throw new TypeError('defineFontFamily 需要 1 到 64 个字面')
    const locations = options.faces.map(face => {
        const location = typeof face.src === 'string' ? face.src : face.src?.path
        if (typeof location !== 'string' || !location) throw new TypeError('字面 src 需要非空字符串地址')
        return location
    })
    for (const face of options.faces) {
        if (face.weight !== undefined && !isFontWeight(face.weight)) throw new RangeError('字面 weight 需要 1 到 1000 的整数')
        if (face.style !== undefined && face.style !== 'normal' && face.style !== 'italic') throw new TypeError("字面 style 只能是 'normal' 或 'italic'")
    }
    const familyName = name.trim()
    const state = shallowRef<{ status: FontFamilyStatus; error?: string }>({ status: 'loading' })
    const faces: Face[] = []
    let pending = options.faces.length
    let preloading = false
    let disposed = false

    const endPreload = () => {
        if (!preloading) return
        preloading = false
        native.endFontPreload()
    }
    // 每到一个字面就把已到达的字面整体登记一次，登记即推进字体环境代际
    const publish = () => {
        const ready = faces.filter(face => face.state.status === 'ready')
        if (ready.length === 0) return
        native.defineFontFamily(familyName, ready.map(face => ({ ...face.handle, contentVersion: face.state.contentVersion, ...(face.declaration.weight === undefined ? {} : { weight: face.declaration.weight }), ...(face.declaration.style === undefined ? {} : { style: face.declaration.style }) })))
    }
    const settle = () => {
        if (disposed || --pending > 0) return
        const failed = faces.find(face => face.state.status === 'failed')
        state.value = faces.every(face => face.state.status === 'failed') ? { status: 'failed', error: failed?.state.error } : { status: 'ready', error: failed?.state.error }
        endPreload()
    }

    if (options.preload) {
        preloading = true
        native.beginFontPreload()
    }
    for (const [index, declaration] of options.faces.entries()) {
        const location = locations[index]
        const face: Face = { declaration, handle: undefined as unknown as NativeBindingHandle, state: { status: 'loading', contentVersion: 0 } }
        faces.push(face)
        const complete = (completion: PainterCompletion) => {
            if (disposed || face.state.status !== 'loading') return
            face.state.contentVersion = completion.contentVersion
            face.state.status = completion.error ? 'failed' : 'ready'
            if (completion.error) face.state.error = completion.error
            else publish()
            settle()
        }
        const { ready, ...handle } = native.acquirePainter(location, complete)
        ;(face as { handle: NativeBindingHandle }).handle = handle
        if (ready) complete(ready)
    }

    const result: FontFamily = Object.freeze({
        name: familyName,
        get status() { return state.value.status },
        get error() { return state.value.error },
        dispose() {
            if (disposed) return
            disposed = true
            state.value = { status: 'disposed' }
            endPreload()
            native.removeFontFamily(familyName)
            for (const face of faces) native.releasePainter(face.handle)
        },
    })
    if (getCurrentScope()) onScopeDispose(result.dispose)
    return result
}
