<script setup>
import {computed, dp, m, sp, Color} from '@arrange/framework'
import ValueSurface from './ValueSurface.vue'

const props = defineProps(['clicks', 'color', 'offset', 'onTap'])
const label = computed(() => `撅: ${props.clicks}`)
const tone = computed(() => normalizeTone(props.color))

function normalizeTone(value) {
    return Color(value)
}
</script>

<template>
    <ValueSurface :tone="tone" :offset="offset">
        <template #default="{tone: background, offset: position}">
            <Text
                :text="label"
                :text-style="{fontSize: sp(13), color: Color(0xFFE8EAED)}"
                :modifier="m.size(dp(160), dp(28)).offset({x: position}).background(background).clickable(onTap)"
            />
        </template>
    </ValueSurface>
</template>
