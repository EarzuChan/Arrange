<template>
    <ValueSurface :tone="color" :offset="offset" v-slot="{tone: surfaceTone, offset: surfaceOffset}">
        <Text :text="label(caption)" :text-style="{fontSize: 12, color: 0xffe6eef5}" :modifier="m.width(280).height(30).offset({x: surfaceOffset}).background(surfaceTone).padding(6).clickable(() => onSelect(item.id)).keyed('条目交互')" />
    </ValueSurface>
</template>

<script setup lang="ts">
import {computed, m, tween, animatedColorAsRef, animatedDpAsRef} from '@arrange/framework'
import ValueSurface from './ValueSurface.vue'

const props = defineProps<{item: {id: number; name: string}; selected: boolean; tone: number; onSelect: (id: number) => void}>()
const color = animatedColorAsRef(() => props.selected ? props.tone : 0xff263443, {animationSpec: tween({durationMillis: 180})})
const offset = animatedDpAsRef(() => props.selected ? 8 : 0, {animationSpec: tween({durationMillis: 180})})
const caption = computed(() => `${props.item.id.toString().padStart(3, '0')}  ${props.item.name}`)
function label(value: string) { return value }
</script>