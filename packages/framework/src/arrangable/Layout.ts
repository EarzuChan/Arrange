import { currentInstance, ValueBinding, invokeContent } from '../runtime/internal.ts'
import { defineArrangable } from '../runtime/index.ts'
import type { ArrangableProps, PropType } from '../runtime/index.ts'
import { LayoutRearrangeNode, NativeRearrangeHost } from '../rearrangeNode.ts'
import { isMeasurePolicy } from '../measurePolicy.ts'
import type { MeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'
import { inject } from '../runtime/apiInject.ts'
import { DensityKey } from '../density.ts'
import { UnitResolver } from '../resolveUnits.ts'

export type LayoutProps = ArrangableProps<typeof Layout>
export const Layout = defineArrangable({
    name: 'Layout',
    props: { modifier: { type: Modifier, default: M }, measurePolicy: { type: Object as PropType<MeasurePolicy>, required: true, validator: isMeasurePolicy }, enabled: Boolean, contentDescription: String },
    slotNames: ['default'],
    setup(props, { slot, source }) {
        const instance = currentInstance!
        const density = inject(DensityKey)
        if (!density) throw new Error('Layout 缺少 App 的 Density 服务')
        const units = new UnitResolver(density)

        // TIPS：唯一真豪组件，可以直撅NativeRearrangeHost
        const host = instance.appContext.host
        if (!(host instanceof NativeRearrangeHost)) throw new Error('Layout 需要正式原生应用宿主')

        const node = new LayoutRearrangeNode(instance, host)
        instance.node = node

        new ValueBinding(() => units.measurePolicy(props.measurePolicy), instance, value => node.updateMeasurePolicy(value as MeasurePolicy), source('measurePolicy'))
        new ValueBinding(() => units.modifier(props.modifier), instance, value => node.updateModifier(value as import('../resolveUnits.ts').PxModifier), source('modifier'))
        new ValueBinding(() => props.enabled, instance, value => node.updateInput('enabled', value as boolean | undefined), source('enabled'))
        new ValueBinding(() => props.contentDescription, instance, value => node.updateInput('contentDescription', value as string | undefined), source('contentDescription'))

        const content = slot()
        return () => invokeContent(0, content)
    },
})
