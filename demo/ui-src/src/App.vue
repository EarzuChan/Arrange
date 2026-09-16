<template>
    <Column
        :modifier="m.fillMaxSize().padding(dp(12)).background(Color(0xFF000000))"
        :vertical-arrangement="Arrangement.spacedBy(dp(8))"
    >
        <Row :horizontal-arrangement="Arrangement.spacedBy(dp(8))">
            <Icon
                source="icons/play.svg"
                :tint="Color(0xFF00FFFF)"
                :modifier="m.size(dp(20), dp(20))"
            />
            <Text
                :text="preset"
                :text-style="{ fontSize: sp(50), color: presetColor }"
                :modifier="m"
            />
            <Image
                source="logo.png"
                :modifier="m.size(dp(96), dp(40))"
            />
        </Row>
        <Row
            :horizontal-arrangement="Arrangement.spacedBy(dp(8))"
            :modifier="m.fillMaxWidth().height(dp(44))"
        >
            <Box :modifier="m.size(dp(180), dp(38)).background(Color(0xFF3A7AFE))"/>
            <Spacer :modifier="m.width(dp(8))"/>
            <Box :modifier="m.size(dp(180), dp(38)).background(Color(0xFFFFB020))"/>
        </Row>
        <Spacer :modifier="m.height(dp(4))"/>
        <CounterPanel :clicks="clicks" :color="counterColor" :offset="counterOffset" :onTap="handleTap" />
        <Input
            v-model="preset"
            placeholder="Search preset"
            :select-all-on-focus="true"
            :onSubmit="handleSubmit"
            :onChange="handleChange"
            :onBlur="handleBlur"
            :text-style="{ fontSize: sp(13), color: Color(0xFFE8EAED) }"
            :modifier="m.size(dp(240), dp(28)).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563))"
        />
        <Text
            :text="inputStatus"
            :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
            :modifier="m.height(dp(16))"
        />
        <Column
            :modifier="m.size(dp(260), dp(58)).verticalScroll(scrollState).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563))"
            :vertical-arrangement="Arrangement.spacedBy(dp(4))"
        >
            <Text
                text="Scroll viewport"
                :text-style="{ fontSize: sp(12), color: Color(0xFFE8EAED) }"
                :modifier="m.height(dp(14))"
            />
            <Text
                text="Scroll modifier travels through native state"
                :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
                :modifier="m.height(dp(14))"
            />
            <Text
                text="Wheel updates native scroll state"
                :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
                :modifier="m.height(dp(14))"
            />
            <Text
                text="Hidden row appears after wheel"
                :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
                :modifier="m.height(dp(14))"
            />
        </Column>
        <Text
            text="Vue SFC authoring, Compose-like layout, JUCE-native target。度尽劫波兄弟在，相逢一笑泯恩仇"
            :text-style="{ fontSize: sp(13), color: Color(0xFFB8BDC7) }"
            :modifier="m.border(dp(1), Color(0xFF4B5563))"
        />
    </Column>
</template>

<script setup>
import {animateDpAsState, animateColorAsState, Arrangement, Color, dp, Icon, logger, m, onMounted, onUnmounted, ref, rememberScrollState, sp} from "@arrange/framework"

import CounterPanel from './components/CounterPanel.vue'

const clicks = ref(0)
const counterOffset = animateDpAsState(() => clicks.value % 2 ? dp(6) : dp(0), {durationMillis: 240})
const preset = ref("Preset A")
const rainbow = [0xFFFF3030, 0xFFFFFF30, 0xFF30FF30, 0xFF30FFFF, 0xFF3030FF, 0xFFFF30FF]
const presetColorTarget = ref(Color(rainbow[0]))
const presetColor = animateColorAsState(presetColorTarget, {durationMillis: 700})
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
    rainbowFrame = requestAnimationFrame(advanceRainbow)
})
onUnmounted(() => {
    cancelAnimationFrame(rainbowFrame)
    presetColor.stop()
})

const inputStatus = ref("Input: focus, type, Enter to submit")
const scrollState = rememberScrollState()
const counterColor = animateColorAsState(
    () => clicks.value % 2 === 0 ? Color(0xFF2E7D32) : Color(0xFF3A7AFE),
    { durationMillis: 240 },
)

function handleTap() {
    clicks.value += 1
    logger.info("恩情" + clicks.value)
    console.log("南下" + clicks.value)
}

function handleSubmit(value) {
    inputStatus.value = `Submitted: ${value}`
}

function handleChange(value) {
    inputStatus.value = `Changed: ${value}`
}

function handleBlur(value) {
    inputStatus.value = `Blurred: ${value}`
}
</script>
