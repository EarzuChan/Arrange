import { currentInstance, ValueBinding, invokeContent } from '../runtime/internal.ts'
import { defineArrangable } from '../runtime/index.ts'
import type { ArrangableProps, PropType } from '../runtime/index.ts'
import { LayoutRearrangeNode, NativeRearrangeHost } from '../nativeRearrange.ts'
import { isMeasurePolicy } from '../measurePolicy.ts'
import type { MeasurePolicy } from '../measurePolicy.ts'
import { M, Modifier } from '../modifier.ts'
import { inject } from '../runtime/apiInject.ts'
import { DensityKey } from '../density.ts'
import { ModifierLowering } from '../modifierLowering.ts'
import type { LayoutContentProvider } from '../layoutContent.ts'

export type LayoutProps = ArrangableProps<typeof Layout>
export const Layout = defineArrangable({
    name: 'Layout',
    props: { modifier: { type: Modifier, default: M }, measurePolicy: { type: Object as PropType<MeasurePolicy>, required: true, validator: isMeasurePolicy }, contentProvider: Object as PropType<LayoutContentProvider>, enabled: Boolean },
    slotNames: ['default'],
    setup(props, { slot, source }) {
        const instance = currentInstance!

        const density = inject(DensityKey)
        if (!density) throw new Error('Layout 缺少 App 的 Density 服务')

        const units = new ModifierLowering(density, instance)

        // TIPS：唯一真豪组件，可以直撅NativeRearrangeHost
        const host = instance.appContext.host
        if (!(host instanceof NativeRearrangeHost)) throw new Error('Layout 需要正式原生应用宿主')

        const node = new LayoutRearrangeNode(instance, host)
        instance.node = node
        if (props.contentProvider) node.setContentProvider(props.contentProvider)

        new ValueBinding(() => units.measurePolicy(props.measurePolicy), instance, value => node.updateMeasurePolicy(value as MeasurePolicy), source('measurePolicy'))
        new ValueBinding(() => units.modifier(props.modifier), instance, value => node.updateModifier(value as import('../modifierLowering.ts').PxModifier), source('modifier'))
        new ValueBinding(() => props.enabled, instance, value => node.updateInput('enabled', value as boolean | undefined), source('enabled'))

        const content = slot()
        return () => props.contentProvider ? props.contentProvider.render() : invokeContent(0, content)
    },
})
