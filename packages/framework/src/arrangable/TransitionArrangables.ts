import { Box } from './LayoutingArrangables.ts'
import { arrangeScope, defineArrangable, onMounted, shallowRef, watch } from "../runtime/index.ts"
import type { Arrangable, ArrangableProps, PropType } from "../runtime/index.ts"
import { animatedNumberAsRef, tween } from "../animation.ts"
import type { AnimationClock, AnimationSpec } from "../animation.ts"
import { M } from "../modifier.ts"

export type VisibilityTransform = Readonly<{ alpha?: number; translationX?: number; translationY?: number; scaleX?: number; scaleY?: number }>
const clampAlpha = (value: number) => Math.max(0, Math.min(1, value))

export type AnimatedVisibilityProps = ArrangableProps<typeof AnimatedVisibility>
export const AnimatedVisibility = defineArrangable({
    name: "AnimatedVisibility",
    slotNames: ["default"],
    props: {
        visible: { type: Boolean, required: true },
        appear: Boolean,
        animationSpec: { type: Object as PropType<AnimationSpec>, default: () => tween() },
        clock: Object as PropType<AnimationClock>,
        enterFrom: { type: Object as PropType<VisibilityTransform>, default: () => ({ alpha: 0 }) },
        exitTo: { type: Object as PropType<VisibilityTransform>, default: () => ({ alpha: 0 }) },
    },
    setup(props, { call, slot }) {
        const retained = shallowRef(props.visible)
        const target = shallowRef(props.visible && !props.appear ? 1 : 0)
        const progress = animatedNumberAsRef(target, { animationSpec: props.animationSpec, clock: props.clock })
        onMounted(() => { target.value = props.visible ? 1 : 0 })
        watch(() => props.visible, visible => {
            if (visible) retained.value = true
            target.value = visible ? 1 : 0
        }, { flush: "sync" })
        watch(() => [props.visible, progress.isRunning.value, progress.value], () => {
            if (!props.visible && !progress.isRunning.value && progress.value === 0) retained.value = false
        }, { flush: "post" })
        return () => {
            if (retained.value) call(0, Box, {
                // 退出开始时禁用交互，焦点和命中结果随原生发布一起更新
                enabled: () => props.visible,
                modifier: () => {
                    const edge = props.visible ? props.enterFrom : props.exitTo
                    const remaining = 1 - progress.value
                    return M.graphicsLayer({
                        alpha: clampAlpha(1 - (1 - (edge.alpha ?? 0)) * remaining),
                        translationX: (edge.translationX ?? 0) * remaining,
                        translationY: (edge.translationY ?? 0) * remaining,
                        scaleX: 1 - (1 - (edge.scaleX ?? 1)) * remaining,
                        scaleY: 1 - (1 - (edge.scaleY ?? 1)) * remaining,
                    })
                },
            }, { default: slot() })
        }
    },
})

type CrossfadeEntry = { id: number; value: unknown; definition: Arrangable; params: Record<string, unknown>; initial: boolean }
const CrossfadeLayer = defineArrangable({
    props: {
        entry: { type: Object as PropType<CrossfadeEntry>, required: true },
        active: Boolean,
        animationSpec: { type: Object as PropType<AnimationSpec>, required: true },
        clock: Object as PropType<AnimationClock>,
        retire: { type: Function as PropType<(entry: CrossfadeEntry) => void>, required: true },
    },
    setup(props, { call }) {
        const target = shallowRef(props.entry.initial ? 1 : 0)
        const alpha = animatedNumberAsRef(target, { animationSpec: props.animationSpec, clock: props.clock })
        onMounted(() => { target.value = props.active ? 1 : 0 })
        watch(() => props.active, active => { target.value = active ? 1 : 0 }, { flush: "sync" })
        watch(() => [props.active, alpha.isRunning.value, alpha.value], () => {
            if (!props.active && !alpha.isRunning.value && alpha.value === 0) props.retire(props.entry)
        }, { flush: "post" })
        return () => call(0, Box, {
            enabled: () => props.active,
            modifier: () => M.alpha(clampAlpha(alpha.value)),
        }, { default: () => call(0, props.entry.definition, Object.fromEntries(Object.keys(props.entry.params).map(name => [name, () => props.entry.params[name]]))) })
    },
})

export type CrossfadeProps = ArrangableProps<typeof Crossfade>
export const Crossfade = defineArrangable({
    name: "Crossfade",
    props: {
        is: { type: Object as PropType<Arrangable>, required: true },
        props: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
        targetState: { required: true },
        animationSpec: { type: Object as PropType<AnimationSpec>, default: () => tween() },
        clock: Object as PropType<AnimationClock>,
    },
    setup(props, { call }) {
        let nextId = 1

        const entry = (initial: boolean): CrossfadeEntry => ({ id: nextId++, value: props.targetState, definition: props.is, params: { ...props.props }, initial })
        const entries = shallowRef<CrossfadeEntry[]>([entry(true)])
        const retire = (retired: CrossfadeEntry) => { if (!Object.is(retired.value, props.targetState)) entries.value = entries.value.filter(item => item.id !== retired.id) }

        // 参数组装完成后读取整组输入，退出中的层保留切换前的定义与参数
        watch(() => [props.targetState, props.is, props.props], () => {
            const active = entries.value.find(item => Object.is(item.value, props.targetState))
            entries.value = active ? entries.value.map(item => item.id === active.id ? { ...item, definition: props.is, params: { ...props.props } } : item) : [...entries.value, entry(false)]
        })

        return () => call(0, Box, {}, {
            default: () => {
                for (const item of entries.value) arrangeScope(0, () => call(0, CrossfadeLayer, {
                    entry: () => item,
                    active: () => Object.is(item.value, props.targetState),
                    animationSpec: () => props.animationSpec,
                    clock: () => props.clock,
                    retire: () => retire,
                }), item.id)
            }
        })
    },
})