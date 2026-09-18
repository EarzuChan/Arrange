<script setup>
import {ref, shallowRef, h, defineAsyncComponent, getArrangeExecutionStats} from '@arrange/framework'
import AnimationGallery from '../../../demo/ui-src/src/components/AnimationGallery.vue'
import CounterPanel from '../../../demo/ui-src/src/components/CounterPanel.vue'
import ShowcaseGallery from '../../../demo/ui-src/src/components/ShowcaseGallery.vue'

const color = ref(0xff336699)
const offset = ref(0)
const clicks = ref(0)
const shown = ref(true)
const rows = ref([{id: 'a', name: 'A'}, {id: 'b', name: 'B'}])
const gallery = ref(false)
const galleryCommand = ref('')
const showcase = ref(false)
const showcaseCommand = ref('')
const missingResource = ref(false)
let commandSequence = 0
let baseline
let performanceBaseline
let lifetimeBaseline
const asyncProbe = shallowRef(null)
let finishAsync

function startAsyncProbe() {
    asyncProbe.value = defineAsyncComponent({
        loader: () => new Promise(resolve => { finishAsync = () => resolve({setup: () => () => h('Text', {text: '延迟加载完成'})}) }),
        loadingComponent: {setup: () => () => h('Text', {text: '延迟加载提示'})},
        errorComponent: {props: ['error'], setup: () => () => h('Text', {text: '延迟加载超时'})},
        delay: 32,
        timeout: 96,
    })
}

function tap() { clicks.value++ }
function command(value) {
    if (value === 'bad-resource') missingResource.value = true
    else if (value === 'lifetime-baseline') lifetimeBaseline = getArrangeExecutionStats().activeValueBindings
    else if (value === 'lifetime-check') {
        if (getArrangeExecutionStats().activeValueBindings !== lifetimeBaseline) throw new Error('整页退出后仍有 JS 值绑定存活')
    }
    else if (value === 'perf-baseline') performanceBaseline = getArrangeExecutionStats()
    else if (value === 'perf-report') {
        const current = getArrangeExecutionStats()
        const delta = Object.fromEntries(Object.keys(current).map(key => [key, current[key] - performanceBaseline[key]]))
        console.log(`M23_JS_PERF ${JSON.stringify(delta)}`)
    }
    else if (value === 'async-start') startAsyncProbe()
    else if (value === 'async-finish') finishAsync?.()
    else if (value === 'async-remove') asyncProbe.value = null
    else if (value === 'showcase') showcase.value = true
    else if (value === 'showcase-remove') showcase.value = false
    else if (value.startsWith('showcase:')) showcaseCommand.value = `${value.slice(9)}:${++commandSequence}`
    else if (value === 'gallery') { galleryCommand.value = ''; gallery.value = true }
    else if (value === 'gallery-remove') gallery.value = false
    else if (value.startsWith('gallery:')) galleryCommand.value = value.slice(8)
    else if (value === 'baseline') baseline = getArrangeExecutionStats()
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
        <AnimationGallery v-if="gallery" :command="galleryCommand" />
        <ShowcaseGallery v-if="showcase" :command="showcaseCommand" />
        <component v-if="asyncProbe" :is="asyncProbe" />
        <Image v-if="missingResource" source="missing-m23-image.png" />
    </Column>
</template>
