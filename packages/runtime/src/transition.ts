import {arrangeValue, defineComponent, h, onMounted, shallowRef, watch} from "@arrange/vue-runtime-core"
import type {PropType} from "@arrange/vue-runtime-core"
import {animatedNumberAsRef, tween} from "./animation.ts"
import type {AnimationClock, AnimationSpec} from "./animation.ts"
import {m} from "./modifier.ts"

export type VisibilityTransform = Readonly<{alpha?: number; translationX?: number; translationY?: number; scaleX?: number; scaleY?: number}>
const clampAlpha = (value: number) => Math.max(0, Math.min(1, value))

export const AnimatedVisibility = defineComponent({
    name: "AnimatedVisibility",
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
        return () => retained.value ? h("Box", {
            // Disabled at the start of exit; native publication clears focus and hit regions together.
            enabled: arrangeValue(() => props.visible),
            modifier: arrangeValue(() => {
                const edge = props.visible ? props.enterFrom : props.exitTo
                const remaining = 1 - progress.value
                return m.graphicsLayer({
                    alpha: clampAlpha(1 - (1 - (edge.alpha ?? 0)) * remaining),
                    translationX: (edge.translationX ?? 0) * remaining,
                    translationY: (edge.translationY ?? 0) * remaining,
                    scaleX: 1 - (1 - (edge.scaleX ?? 1)) * remaining,
                    scaleY: 1 - (1 - (edge.scaleY ?? 1)) * remaining,
                })
            }),
        }, slots.default?.()) : null
    },
})

type CrossfadeEntry = {id: number; value: unknown; initial: boolean}
const CrossfadeLayer = defineComponent({
    props: {
        entry: {type: Object as PropType<CrossfadeEntry>, required: true},
        active: Boolean,
        animationSpec: {type: Object as PropType<AnimationSpec>, required: true},
        clock: Object as PropType<AnimationClock>,
        retire: {type: Function as PropType<(entry: CrossfadeEntry) => void>, required: true},
    },
    setup(props, {slots}) {
        const target = shallowRef(props.entry.initial ? 1 : 0)
        const alpha = animatedNumberAsRef(target, {animationSpec: props.animationSpec, clock: props.clock})
        onMounted(() => { target.value = props.active ? 1 : 0 })
        watch(() => props.active, active => { target.value = active ? 1 : 0 }, {flush: "sync"})
        watch(() => [props.active, alpha.isRunning.value, alpha.value], () => {
            if (!props.active && !alpha.isRunning.value && alpha.value === 0) props.retire(props.entry)
        }, {flush: "post"})
        return () => h("Box", {
            enabled: arrangeValue(() => props.active),
            modifier: arrangeValue(() => m.alpha(clampAlpha(alpha.value))),
        }, slots.default?.({state: props.entry.value}))
    },
})

export const Crossfade = defineComponent({
    name: "Crossfade",
    props: {
        targetState: {required: true},
        animationSpec: {type: Object as PropType<AnimationSpec>, default: () => tween()},
        clock: Object as PropType<AnimationClock>,
    },
    setup(props, {slots}) {
        let nextId = 1
        const entries = shallowRef<CrossfadeEntry[]>([{id: nextId++, value: props.targetState, initial: true}])
        const retire = (entry: CrossfadeEntry) => {
            if (!Object.is(entry.value, props.targetState)) entries.value = entries.value.filter(item => item !== entry)
        }
        watch(() => props.targetState, value => {
            if (!entries.value.some(entry => Object.is(entry.value, value))) entries.value = [...entries.value, {id: nextId++, value, initial: false}]
        }, {flush: "sync"})
        return () => h("Box", null, entries.value.map(entry => h(CrossfadeLayer, {
            key: entry.id,
            entry,
            active: arrangeValue(() => Object.is(entry.value, props.targetState)),
            animationSpec: props.animationSpec,
            clock: props.clock,
            retire,
        }, slots)))
    },
})
