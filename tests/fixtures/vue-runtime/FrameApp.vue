<script setup>
import {ref, getArrangeExecutionStats} from '@arrange/framework'
import CounterPanel from '../../../demo/ui-src/src/components/CounterPanel.vue'

const color = ref(0xff336699)
const offset = ref(0)
const clicks = ref(0)
const shown = ref(true)
const rows = ref([{id: 'a', name: 'A'}, {id: 'b', name: 'B'}])
let baseline
function tap() { clicks.value++ }
function command(value) {
    if (value === 'baseline') baseline = getArrangeExecutionStats()
    else if (value === 'color') color.value = color.value === 0xff336699 ? 0xff993366 : 0xff336699
    else if (value === 'offset') offset.value += 5
    else if (value === 'text') clicks.value++
    else if (value === 'remove') shown.value = false
    else if (value === 'restore') shown.value = true
    else if (value === 'reorder') rows.value.reverse()
    else if (value === 'validate') {
        const current = getArrangeExecutionStats()
        if (!baseline || current.structureRuns !== baseline.structureRuns) throw new Error('Value update reran a structural scope')
        if (current.activeValueBindings !== baseline.activeValueBindings) throw new Error('Value update leaked bindings')
    } else throw new Error(`Unknown command: ${value}`)
}
</script>

<template>
    <Column>
        <CounterPanel v-if="shown" :clicks="clicks" :color="color" :offset="offset" :onTap="tap" />
        <Text v-for="row in rows" :key="row.id" :text="row.name" />
        <Input @submit="command" />
    </Column>
</template>
