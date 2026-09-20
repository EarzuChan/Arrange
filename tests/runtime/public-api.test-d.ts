import { painter, Alignment, Arrangement, Column, ContentScale, Image, Input, Text, arrangeValue, createApp, createScrollState, defineArrangable, h, M, ref, type PropType, type BoxProps, type ColumnProps, type ImageProps, type InputProps, type RowProps, type TextProps } from '@arrange/framework'

const text = ref('原生输入')
const inputProps = { value: '初始内容', onSubmit: (value: string) => { text.value = value } } satisfies InputProps
const textProps = { text: '标题', textStyle: { fontSize: 16, color: 0xff336699 } } satisfies TextProps
const imageProps = { painter: painter({ path: 'logo.png' }) } satisfies ImageProps

const rowProps = { horizontalArrangement: Arrangement.spacedBy(8, Alignment.End), verticalAlignment: Alignment.Baseline } satisfies RowProps
const columnProps = { verticalArrangement: Arrangement.spacedBy(8, Alignment.Bottom), horizontalAlignment: Alignment.CenterHorizontally } satisfies ColumnProps
const scaledImage = { painter: painter('logo.png'), contentScale: ContentScale.FillWidth, alignment: Alignment.BottomEnd } satisfies ImageProps

// @ts-expect-error 图片缩放仅接受已实现的枚举
const invalidScale: ImageProps = { painter: painter('logo.png'), contentScale: 'Crpo' }
// @ts-expect-error 图片没有基线对齐
const invalidImageAlignment: ImageProps = { painter: painter('logo.png'), alignment: Alignment.Baseline }
// @ts-expect-error Box 要求二维对齐
const invalidBoxAlignment: BoxProps = { contentAlignment: Alignment.Baseline }
// @ts-expect-error Row 的交叉轴不能使用水平对齐
const invalidRowAlignment: RowProps = { verticalAlignment: Alignment.End }
// @ts-expect-error Column 的交叉轴不能使用垂直对齐
const invalidColumnAlignment: ColumnProps = { horizontalAlignment: Alignment.Bottom }
// @ts-expect-error 水平排列不能使用垂直方向
const invalidArrangement: RowProps = { horizontalArrangement: Arrangement.spacedBy(8, Alignment.Bottom) }
// @ts-expect-error 垂直排列不能使用水平方向
const invalidArrangementName: ColumnProps = { verticalArrangement: Arrangement.End }
// @ts-expect-error 文本对齐不接受拼写错误
const invalidTextAlignment: TextProps = { textAlign: 'middel' }
// @ts-expect-error 原生字体族尚无消费者
const invalidFontStyle: TextProps = { textStyle: { fontFamily: '不存在的字体族' } }
// @ts-expect-error Input 未实现文本对齐选项
const invalidInputAlignment: InputProps = { textAlign: 'center' }
// @ts-expect-error Modifier 对齐不接受任意字符串
M.align('Centre')
// @ts-expect-error spacedBy 对齐不接受二维值
Arrangement.spacedBy(8, Alignment.TopEnd)

// @ts-expect-error Arrangable状态由 setup 声明
defineArrangable({ data: () => ({ count: 1 }) })
// @ts-expect-error Arrangable不接受 Options 生命周期
defineArrangable({ created() {} })
// @ts-expect-error Arrangable不接受 mixins
defineArrangable({ mixins: [] })
// @ts-expect-error createApp 同样拒绝 Options API
createApp({ methods: { act() {} } })
// @ts-expect-error 应用不再提供无效的 mixin 方法
createApp({ setup: () => () => h(Text, { text: '正式Arrangable' }) }).mixin({})

const TypedArrangable = defineArrangable({
    props: { title: { type: String, required: true }, count: { type: Number, default: 2 }, onChange: Function as PropType<(value: number) => void> },
    setup(props) {
        props.title.toUpperCase()
        props.count.toFixed()
        props.onChange?.(props.count)
        // @ts-expect-error 函数参数保持声明的类型
        props.onChange?.('错误')
        // @ts-expect-error props 保持只读
        props.count = 3
        return { selected: ref(true) }
    },
    render() {
        this.selected.valueOf()
        this.count.toFixed()
        // @ts-expect-error setup 返回值不能丢失类型
        this.selected.toFixed()
        return h(Text, { text: this.title })
    },
})

const typedProps: InstanceType<typeof TypedArrangable>['$props'] = { title: '默认 count 可省略', onChange: value => value.toFixed() }
// @ts-expect-error 必填 props 不可省略
const missingTitle: InstanceType<typeof TypedArrangable>['$props'] = {}
// @ts-expect-error props 类型不可被实例构造类型放宽
const wrongCount: InstanceType<typeof TypedArrangable>['$props'] = { title: '标题', count: '错误' }

// @ts-expect-error 字体大小必须是数值
const invalidText: TextProps = { textStyle: { fontSize: '大' } }
// @ts-expect-error 图片必须提供来源
const missingSource: ImageProps = {}
// @ts-expect-error 受控输入回调接收文本
const invalidInput: InputProps = { onSubmit: (value: number) => { } }

M.graphicsLayer({ translationX: 20, transformOrigin: { x: 0.5, y: 0 } }).clickable({ onClick: () => {}, enabled: true })
// @ts-expect-error 图层字段必须属于正式参数集合
M.graphicsLayer({ translation: 20 })
// @ts-expect-error 点击回调必须是函数
M.clickable({ onClick: 1 })
// @ts-expect-error 尺寸范围区分主轴范围与二维范围
M.widthIn({ minWidth: 20 })

export const ManualPage = defineArrangable({
    setup() {
        const scroll = createScrollState()

        return () => h(Column, { modifier: M.height(300).verticalScroll(scroll) }, { default: () => [
            h(Input, inputProps),
            h(Text, { ...textProps, text: arrangeValue(() => text.value) }),
            h(Image, imageProps),
        ] })
    },
})
