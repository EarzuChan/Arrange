import { Box } from './arrangables.ts'
import {arrangeValue, defineArrangable, h, onMounted, renderSlot, shallowRef, watch} from "@arrange/vue-runtime-core"
import type {Arrangable, PropType} from "@arrange/vue-runtime-core"
import {animatedNumberAsRef, tween} from "./animation.ts"
import type {AnimationClock, AnimationSpec} from "./animation.ts"
import {M} from "./modifier.ts"

export type VisibilityTransform = Readonly<{alpha?: number; translationX?: number; translationY?: number; scaleX?: number; scaleY?: number}>
const clampAlpha = (value: number) => Math.max(0, Math.min(1, value))

export const AnimatedVisibility = defineArrangable({
    name: "AnimatedVisibility",
    slotNames: ["default"],
    props: {
        visible: {type: Boolean, required: true},
        appear: Boolean,
        animationSpec: {type: Object as PropType<AnimationSpec>, default: () => tween()},
        clock: Object as PropType<AnimationClock>,
        enterFrom: {type: Object as PropType<VisibilityTransform>, default: () => ({alpha: 0})},
        exitTo: {type: Object as PropType<VisibilityTransform>, default: () => ({alpha: 0})},
    },
    setup(props, {slots}) {
        const retained = shallowRef(props.visible)
        const target = shallowRef(props.visible && !props.appear ? 1 : 0)
        const progress = animatedNumberAsRef(target, {animationSpec: props.animationSpec, clock: props.clock})
        onMounted(() => { target.value = props.visible ? 1 : 0 })
        watch(() => props.visible, visible => {
            if (visible) retained.value = true
            target.value = visible ? 1 : 0
        }, {flush: "sync"})
        watch(() => [props.visible, progress.isRunning.value, progress.value], () => {
            if (!props.visible && !progress.isRunning.value && progress.value === 0) retained.value = false
        }, {flush: "post"})
        return () => retained.value ? h(Box, {
            // 退出开始时禁用交互，焦点和命中结果随原生发布一起更新
            enabled: arrangeValue(() => props.visible),
            modifier: arrangeValue(() => {
                const edge = props.visible ? props.enterFrom : props.exitTo
                const remaining = 1 - progress.value
                return M.graphicsLayer({
                    alpha: clampAlpha(1 - (1 - (edge.alpha ?? 0)) * remaining),
                    translationX: (edge.translationX ?? 0) * remaining,
                    translationY: (edge.translationY ?? 0) * remaining,
                    scaleX: 1 - (1 - (edge.scaleX ?? 1)) * remaining,
                    scaleY: 1 - (1 - (edge.scaleY ?? 1)) * remaining,
                })
            }),
        }, { default: () => [renderSlot(slots, "default")] }) : null
    },
})

type CrossfadeEntry = {id: number; value: unknown; definition: Arrangable; params: Record<string, unknown>; initial: boolean}
const CrossfadeLayer = defineArrangable({
    props: {
        entry: {type: Object as PropType<CrossfadeEntry>, required: true},
        active: Boolean,
        animationSpec: {type: Object as PropType<AnimationSpec>, required: true},
        clock: Object as PropType<AnimationClock>,
        retire: {type: Function as PropType<(entry: CrossfadeEntry) => void>, required: true},
    },
    setup(props) {
        const target = shallowRef(props.entry.initial ? 1 : 0)
        const alpha = animatedNumberAsRef(target, {animationSpec: props.animationSpec, clock: props.clock})
        onMounted(() => { target.value = props.active ? 1 : 0 })
        watch(() => props.active, active => { target.value = active ? 1 : 0 }, {flush: "sync"})
        watch(() => [props.active, alpha.isRunning.value, alpha.value], () => {
            if (!props.active && !alpha.isRunning.value && alpha.value === 0) props.retire(props.entry)
        }, {flush: "post"})
        return () => h(Box, {
            enabled: arrangeValue(() => props.active),
            modifier: arrangeValue(() => M.alpha(clampAlpha(alpha.value))),
        }, { default: () => [h(props.entry.definition, props.entry.params)] })
    },
})

export const Crossfade = defineArrangable({
    name: "Crossfade",
    props: {
        is: {type: Object as PropType<Arrangable>, required: true},
        props: {type: Object as PropType<Record<string, unknown>>, default: () => ({})},
        targetState: {required: true},
        animationSpec: {type: Object as PropType<AnimationSpec>, default: () => tween()},
        clock: Object as PropType<AnimationClock>,
    },
    setup(props) {
        let nextId = 1
        const entry = (initial: boolean): CrossfadeEntry => ({id: nextId++, value: props.targetState, definition: props.is, params: {...props.props}, initial})
        const entries = shallowRef<CrossfadeEntry[]>([entry(true)])
        const retire = (retired: CrossfadeEntry) => {
            if (!Object.is(retired.value, props.targetState)) entries.value = entries.value.filter(item => item.id !== retired.id)
        }

        // 参数组装完成后读取整组输入，退出中的层保留切换前的定义与参数
        watch(() => [props.targetState, props.is, props.props], () => {
            const active = entries.value.find(item => Object.is(item.value, props.targetState))
            entries.value = active ? entries.value.map(item => item.id === active.id ? {...item, definition: props.is, params: {...props.props}} : item) : [...entries.value, entry(false)]
        })

        return () => h(Box, null, { default: () => entries.value.map(item => h(CrossfadeLayer, {
            key: item.id,
            entry: item,
            active: arrangeValue(() => Object.is(item.value, props.targetState)),
            animationSpec: props.animationSpec,
            clock: props.clock,
            retire,
        })) })
    },
})
