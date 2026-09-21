import { currentInstance, ValueBinding, invokeContent } from '@arrange/vue-runtime-core/internal'
import { defineArrangable } from '@arrange/vue-runtime-core'
import type { ArrangableProps, PropType } from '@arrange/vue-runtime-core'
import { LayoutRearrangeNode, NativeComposition } from '../rearrangeNode.ts'
import { isMeasurePolicy } from '../measurePolicy.ts'
import type { MeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'

export type LayoutProps = ArrangableProps<typeof Layout>
export const Layout = defineArrangable({
    name: 'Layout',
    props: { modifier: { type: Modifier, default: M }, measurePolicy: { type: Object as PropType<MeasurePolicy>, required: true, validator: isMeasurePolicy }, enabled: Boolean, contentDescription: String },
    slotNames: ['default'],
    setup(props, { slot, source }) {
        const instance = currentInstance!

        // TIPS：唯一真豪组件，可以直撅NativeComposition
        const host = instance.appContext.host
        if (!(host instanceof NativeComposition)) throw new Error('Layout 需要正式原生应用宿主')

        const node = new LayoutRearrangeNode(instance, host)
        instance.node = node

        new ValueBinding(() => props.measurePolicy, instance, value => node.updateMeasurePolicy(value as MeasurePolicy), source('measurePolicy'))
        new ValueBinding(() => props.modifier, instance, value => node.updateModifier(value as Modifier), source('modifier'))
        new ValueBinding(() => props.enabled, instance, value => node.updateInput('enabled', value as boolean | undefined), source('enabled'))
        new ValueBinding(() => props.contentDescription, instance, value => node.updateInput('contentDescription', value as string | undefined), source('contentDescription'))

        const content = slot()
        return () => invokeContent(0, content)
    },
})
