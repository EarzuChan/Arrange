<template>
    <Text :text="text" :text-style="{fontSize: 12, color: active ? 0xff101c26 : 0xffdae6f0}" :modifier="m.padding({horizontal: 10, vertical: 7}).background(active ? 0xff61d6bb : 0xff29394a).clickable(onClick)" />
</template>

<script setup lang="ts">
import {m} from '@arrange/framework'

defineProps<{text: string; active?: boolean; onClick: () => void}>()
</script>