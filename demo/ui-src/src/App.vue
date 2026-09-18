<template>
    <Column :modifier="m.fillMaxSize().background(0xff0e1722).verticalScroll(pageScroll).padding(dp(18))" :vertical-arrangement="Arrangement.spacedBy(dp(12))">
        <Row :horizontal-arrangement="Arrangement.spacedBy(dp(8))">
            <Icon source="icons/play.svg" :tint="Color(0xFF00FFFF)" :modifier="m.size(dp(20), dp(20))"/>

            <Text :text="preset" :text-style="{ fontSize: sp(28), color: presetColor }" :modifier="m"/>

            <Image source="logo.png" :modifier="m.size(dp(96), dp(40))"/>
        </Row>

        <Row :horizontal-arrangement="Arrangement.spacedBy(dp(8))" :modifier="m.fillMaxWidth().height(dp(44))">
            <Box :modifier="m.size(dp(180), dp(38)).background(Color(0xFF3A7AFE))"/>

            <Spacer :modifier="m.width(dp(8))"/>

            <Box :modifier="m.size(dp(180), dp(38)).background(Color(0xFFFFB020))"/>
        </Row>

        <Spacer :modifier="m.height(dp(4))"/>

        <CounterPanel :clicks="clicks" :color="counterColor" :offset="counterOffset" :onTap="handleTap" />

        <Input v-model="preset" placeholder="搜索格调" :select-all-on-focus="true" :onSubmit="handleSubmit" :onChange="handleChange" :onBlur="handleBlur" :text-style="{ fontSize: sp(13), color: Color(0xFFE8EAED) }" :modifier="m.size(dp(240), dp(28)).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563))"/>

        <Text :text="inputStatus" :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }" :modifier="m.height(dp(16))"/>

        <Column :modifier="m.size(dp(260), dp(58)).verticalScroll(scrollState).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563))" :vertical-arrangement="Arrangement.spacedBy(dp(4))">
            <Text text="才不想当你的滚动视口呢，哼" :text-style="{ fontSize: sp(12), color: Color(0xFFE8EAED) }" :modifier="m.height(dp(14))"/>

            <Text text="滚动modifier逛遍本地状态（意味不明）" :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }" :modifier="m.height(dp(14))"/>

            <Text text="滚轮也可以触发啊一个" :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }" :modifier="m.height(dp(14))"/>

            <Text text="这个你滚动后才能看见嘛（喜）" :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }" :modifier="m.height(dp(14))"/>
        </Column>

        <Row :horizontal-arrangement="Arrangement.spacedBy(16)">
            <ShowcaseGallery />
            恩情
            <AnimationGallery />
        </Row>

        <Text text="Arrangeの本格界面" :text-style="{fontSize: 12, color: 0xff91a6b8}" />
    </Column>
</template>

<script setup>
import {tween, linearEasing, animatedDpAsRef, animatedColorAsRef, Arrangement, Color, dp, Icon, logger, m, onMounted, onUnmounted, ref, createScrollState, sp} from "@arrange/framework"

import CounterPanel from './components/CounterPanel.vue'
import AnimationGallery from './components/AnimationGallery.vue'
import ShowcaseGallery from './components/ShowcaseGallery.vue'

const clicks = ref(0)
const counterOffset = animatedDpAsRef(() => clicks.value % 2 ? dp(6) : dp(0), {animationSpec: tween({durationMillis: 240, easing: linearEasing})})
const preset = ref("Arrangeの组件与动画发廊")
const rainbow = [0xFFFF3030, 0xFFFFFF30, 0xFF30FF30, 0xFF30FFFF, 0xFF3030FF, 0xFFFF30FF]
const presetColorTarget = ref(Color(rainbow[0]))
const presetColor = animatedColorAsRef(presetColorTarget, {animationSpec: tween({durationMillis: 700, easing: linearEasing})})
let rainbowFrame = 0
let rainbowStartedAt
let rainbowSegment = -1

function advanceRainbow(now) {
    rainbowStartedAt ??= now

    const segment = Math.floor((now - rainbowStartedAt) / 700)

    if (segment !== rainbowSegment) {
        rainbowSegment = segment
        presetColorTarget.value = Color(rainbow[(segment + 1) % rainbow.length])
    }

    rainbowFrame = requestAnimationFrame(advanceRainbow)
}

onMounted(() => {
    rainbowFrame = requestAnimationFrame(advanceRainbow) // 这实在不是什么好东西。人家compose用Transition和对其animateFloat
})

onUnmounted(() => {
    cancelAnimationFrame(rainbowFrame)
    presetColor.stop()
})

const inputStatus = ref("你来和我（指输入框↑）搞一下嘛")
const scrollState = createScrollState()
const pageScroll = createScrollState()
const counterColor = animatedColorAsRef(() => clicks.value % 2 === 0 ? Color(0xFF2E7D32) : Color(0xFF3A7AFE), {animationSpec: tween({durationMillis: 240, easing: linearEasing})})

function handleTap() {
    clicks.value += 1
    logger.info("恩情" + clicks.value)
    console.log("南下" + clicks.value)
}

function handleSubmit(value) {
    inputStatus.value = `提交啊一个：${value}`
}

function handleChange(value) {
    inputStatus.value = `改变：${value}`
}

function handleBlur(value) {
    inputStatus.value = `焦点搞倒：${value}`
}
</script>
