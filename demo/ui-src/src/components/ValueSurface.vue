<script setup>
import {computed} from '@arrange/framework'

const props = defineProps(['tone', 'offset'])
const tone = computed(() => props.tone)
const offset = computed(() => props.offset)
</script>

<template>
    <slot :tone="tone" :offset="offset" />
</template>
