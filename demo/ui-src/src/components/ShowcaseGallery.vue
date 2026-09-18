<template>
    <Column :modifier="m.width(430).padding(16).background(0xff172331)" :vertical-arrangement="Arrangement.spacedBy(10)">
        <Text text="交互实验室" :text-style="{fontSize: 21, color: 0xffedf4fa}" />

        <Text text="组件封装、动态列表、页面保留与异步内容" :text-style="{fontSize: 11, color: 0xff91a6b8}" />

        <Row :horizontal-arrangement="Arrangement.spacedBy(6)">
            <GalleryButton text="列表" :active="page === '列表'" :on-click="() => run('list')" />

            <GalleryButton text="笔记" :active="page === '笔记'" :on-click="() => run('editor')" />

            <GalleryButton text="加载详情" :active="page === '详情'" :on-click="() => run('async')" />

            <GalleryButton text="完成加载" :on-click="() => run('resolve')" />
        </Row>

        <KeepAlive>
            <RetainedEditor v-if="page === '笔记'" />
        </KeepAlive>

        <Suspense v-if="page === '详情'">
            <component :is="AsyncDetails" />

            <template #fallback>
                <Text text="详情正在等待，点击完成加载" :text-style="{color: 0xffd8b970}" />
            </template>
        </Suspense>

        <Column v-if="page === '列表'" :vertical-arrangement="Arrangement.spacedBy(8)">
            <Input v-model="query" placeholder="筛选音轨" :text-style="{color: 0xffedf4fa}" :modifier="m.width(320).height(30).background(0xff263443).padding(6)" />

            <Row :horizontal-arrangement="Arrangement.spacedBy(6)">
                <GalleryButton text="重排" :on-click="() => run('reverse')" />

                <GalleryButton text="删除选中" :on-click="() => run('remove')" />

                <GalleryButton text="恢复" :on-click="() => run('restore')" />
                
                <GalleryButton text="换色" :on-click="() => run('tone')" />
            </Row>

            <Column :modifier="m.width(370).height(220).verticalScroll(scroll)" :vertical-arrangement="Arrangement.spacedBy(4)">
                <GalleryItem v-for="item in filtered" :key="item.id" :item="item" :selected="selected === item.id" :tone="tone" :on-select="select" />
            </Column>

            <Text :text="`显示 ${filtered.length} 条 · 选中 ${selected}`" :text-style="{fontSize: 11, color: 0xff91a6b8}" />
        </Column>

        <GalleryButton text="切换提示" :on-click="() => run('hide')" />

        <AnimatedVisibility :visible="shown" :animation-spec="spec" :exit-to="{alpha: 0, translationX: 20}">
            <Text text="动画期间仍可筛选、重排、删除与切页" :text-style="{fontSize: 12, color: 0xff61d6bb}" />
        </AnimatedVisibility>

        <Crossfade :target-state="page" :animation-spec="spec" v-slot="{state}">
            <Text :text="`当前位置：${state}`" :text-style="{fontSize: 11, color: 0xff91a6b8}" />
        </Crossfade>
    </Column>
</template>

<script setup lang="ts">
import {Arrangement, KeepAlive, Suspense, AnimatedVisibility, Crossfade, computed, createScrollState, defineComponent, h, m, ref, shallowRef, tween, watch} from '@arrange/framework'
import GalleryButton from './GalleryButton.vue'
import GalleryItem from './GalleryItem.vue'
import RetainedEditor from './RetainedEditor.vue'

const props = defineProps({command: {type: String, default: ''}})
const page = ref('列表')
const query = ref('')
const selected = ref(1)
const tone = ref(0xff356b7a)
const shown = ref(true)
const scroll = createScrollState()
const items = ref(Array.from({length: 80}, (_, index) => ({id: index + 1, name: `音轨 ${index + 1}`})))
const filtered = computed(() => items.value.filter(item => item.name.includes(query.value)))
const spec = tween({durationMillis: 240})
let release: (() => void) | undefined
let request = 0
const AsyncDetails = shallowRef(makeAsyncDetails())

function makeAsyncDetails() {
    const identity = ++request
    const ready = new Promise<void>(resolve => { release = resolve })
    return defineComponent({
        name: '异步详情',
        async setup() {
            await ready
            return () => h('Text', {text: `详情已就绪 ${identity}`, textStyle: {fontSize: 13, color: 0xff61d6bb}, modifier: m.padding(8)})
        },
    })
}

function select(id: number) { selected.value = id }

function run(command: string) {
    switch (command) {
        case 'select':
            selected.value = selected.value === 1 ? 2 : 1
            break

        case 'tone':
            tone.value = tone.value === 0xff356b7a ? 0xff735a91 : 0xff356b7a
            break

        case 'reverse':
            items.value.reverse()
            break

        case 'remove':
            items.value = items.value.filter(item => item.id !== selected.value)
            break

        case 'restore':
            items.value = Array.from({length: 80}, (_, index) => ({id: index + 1, name: `音轨 ${index + 1}`}))
            break

        case 'hide':
            shown.value = !shown.value
            break

        case 'editor':
            page.value = '笔记'
            break

        case 'list':
            page.value = '列表'
            break

        case 'async':
            page.value = '详情'
            AsyncDetails.value = makeAsyncDetails()
            break

        case 'resolve':
            release?.()
            break

        case 'filter':
            query.value = query.value ? '' : '音轨 1'
            break

        default: throw new Error(`画廊没有操作 ${command}`)
    }
}

watch(() => props.command, value => { if (value) run(value.split(':')[0]) }, {flush: 'sync'})
</script>