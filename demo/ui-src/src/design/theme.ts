import { inject, ref, type InjectionKey, type Ref } from '@arrange/framework'

// Demo 自用的小设计系统：分组底色上放白卡，层级只靠卡片与字号，不叠第二层底色
export type GalleryTheme = {
    background: number
    card: number
    // 图标底块、按钮、输入框与分段控件的填充
    fill: number
    fillHover: number
    fillPressed: number
    // 白卡上可点区域的悬停底色
    cardHover: number
    separator: number
    label: number
    secondaryLabel: number
    tertiaryLabel: number
    accent: number
    onAccent: number
    // 强调色的浅底，用于选中行
    accentTint: number
    positive: number
    danger: number
    shadow: number
}

export const lightGalleryTheme: GalleryTheme = {
    background: 0xfff2f2f7,
    card: 0xffffffff,
    fill: 0xffefeff4,
    fillHover: 0xffe9e9ee,
    fillPressed: 0xffe3e3e8,
    cardHover: 0xfff7f7fa,
    separator: 0xffe5e5ea,
    label: 0xff111111,
    secondaryLabel: 0xff8a8a8e,
    tertiaryLabel: 0xffc4c4c7,
    accent: 0xff007aff,
    onAccent: 0xffffffff,
    accentTint: 0xffe0edff,
    positive: 0xff34c759,
    danger: 0xffff3b30,
    shadow: 0x1a000000,
}

// 字号阶梯（sp）；没有字重时以字号和颜色区分层级
export const typeScale = {
    largeTitle: 34,
    title: 28,
    cardTitle: 19,
    headline: 17,
    body: 15,
    footnote: 13,
    caption: 12,
} as const

// 标题栏左右的圆形操作位
export type BarAction = Readonly<{ icon: string; label: string; onClick: () => void }>

export const LocalGalleryTheme: InjectionKey<Ref<GalleryTheme>> = Symbol('ArrangeDemo.LocalGalleryTheme')

// 未提供主题时（如测试夹具单独挂载展项）回落到浅色主题
export function useGalleryTheme(): Ref<GalleryTheme> {
    return inject(LocalGalleryTheme, () => ref(lightGalleryTheme), true)
}
