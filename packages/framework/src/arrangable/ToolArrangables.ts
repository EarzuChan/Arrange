import { defineArrangable } from '../runtime/index.ts'
import type { Arrangable, ArrangableProps, PropType } from '../runtime/index.ts'
import { retainContent } from '../runtime/internal.ts'
import type { RearrangeKey } from '../runtime/internal.ts'

export type DynamicArrangableProps = ArrangableProps<typeof DynamicArrangable>
export const DynamicArrangable = defineArrangable({
    name: 'DynamicArrangable',
    props: { is: { type: Object as PropType<Arrangable>, required: true }, props: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) } },
    slotNames: [],
    setup: (props, { call }) => () => call(0, props.is, Object.fromEntries(Object.keys(props.props).map(name => [name, () => props.props[name]]))),
})

export type KeepAliveProps = ArrangableProps<typeof KeepAlive>
export const KeepAlive = defineArrangable({ // 这个没被导出在foundationArrangables？
    name: 'KeepAlive',
    props: { cacheKey: { type: [String, Number, Symbol, BigInt, null] as PropType<RearrangeKey>, required: true }, max: Number },
    slotNames: ['default'],
    setup(props, { slot }) {
        const content = slot()
        return () => retainContent(0, props.cacheKey, content, props.max)
    },
})