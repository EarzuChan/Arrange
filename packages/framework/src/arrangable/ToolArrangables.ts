import { defineArrangable } from '../runtime/index.ts'
import type { Arrangable, ArrangableProps, PropType } from '../runtime/index.ts'
import { isArrangableDefinition } from '../runtime/apiDefineArrangable.ts'
import { retainContent } from '../runtime/internal.ts'
import type { RearrangeKey } from '../runtime/internal.ts'

export type DynamicArrangableProps = ArrangableProps<typeof DynamicArrangable>
export const DynamicArrangable = defineArrangable({
    name: 'DynamicArrangable',
    props: { is: { type: Object as PropType<Arrangable>, required: true, validator: isArrangableDefinition }, props: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) } },
    contentTarget: 'is',
    setup: (props, { call, slots }) => () => call(0, props.is, Object.fromEntries(Object.keys(props.props).map(name => [name, () => props.props[name]])), slots),
})

export type KeepAliveProps = ArrangableProps<typeof KeepAlive>
export const KeepAlive = defineArrangable({
    name: 'KeepAlive',
    props: { cacheKey: { type: [String, Number, Symbol, BigInt, null] as PropType<RearrangeKey>, required: true }, max: { type: Number, default: 10, validator: (value: unknown) => Number.isInteger(value) && Number(value) > 0 } },
    slotNames: ['default'],
    setup(props, { slot }) {
        const content = slot()
        return () => retainContent(0, props.cacheKey, content, props.max)
    },
})