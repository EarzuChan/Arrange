<template>
  <Column
    :modifier="m.fillMaxSize().padding(dp(12)).background(Color(0xFF000000)).testTag('demo-root')"
    :vertical-arrangement="Arrangement.spacedBy(dp(8))"
  >
    <Row :horizontal-arrangement="Arrangement.spacedBy(dp(8))">
      <Icon
        source="play"
        :tint="Color(0xFFE8EAED)"
        :modifier="m.size(dp(20), dp(20)).testTag('play-icon')"
      />
      <Text
        text="恩情"
        :text-style="{ fontSize: sp(50), color: animeColor }"
        :modifier="m.testTag('title')"
      />
      <Image
        source="logo.png"
        :modifier="m.size(dp(96), dp(40)).testTag('demo-logo')"
      />
    </Row>
    <Row
      :horizontal-arrangement="Arrangement.spacedBy(dp(8))"
      :modifier="m.fillMaxWidth().height(dp(44)).testTag('meter-row')"
    >
      <Box :modifier="m.size(dp(180), dp(38)).background(Color(0xFF3A7AFE)).testTag('meter-left')" />
      <Spacer :modifier="m.width(dp(8))" />
      <Box :modifier="m.size(dp(180), dp(38)).background(Color(0xFFFFB020)).testTag('meter-right')" />
    </Row>
    <Spacer :modifier="m.height(dp(4))" />
    <Text
      :text="`Clicks: ${clicks}`"
      :text-style="{ fontSize: sp(13), color: Color(0xFFE8EAED) }"
      :modifier="m.size(dp(160), dp(28)).background(counterColor).clickable(handleTap).testTag('click-counter')"
    />
    <Input
      v-model="preset"
      placeholder="Search preset"
      :select-all-on-focus="true"
      :onSubmit="handleSubmit"
      :onChange="handleChange"
      :onBlur="handleBlur"
      :text-style="{ fontSize: sp(13), color: Color(0xFFE8EAED) }"
      :modifier="m.size(dp(240), dp(28)).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563)).testTag('preset-input')"
    />
    <Text
      :text="inputStatus"
      :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
      :modifier="m.height(dp(16)).testTag('input-status')"
    />
    <Column
      :modifier="m.size(dp(260), dp(58)).verticalScroll(scrollState).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563)).testTag('scroll-preview')"
      :vertical-arrangement="Arrangement.spacedBy(dp(4))"
    >
      <Text
        text="Scroll viewport"
        :text-style="{ fontSize: sp(12), color: Color(0xFFE8EAED) }"
        :modifier="m.height(dp(14)).testTag('scroll-title')"
      />
      <Text
        text="Scroll modifier travels through bridge"
        :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
        :modifier="m.height(dp(14)).testTag('scroll-line-1')"
      />
      <Text
        text="Wheel/state sync comes next"
        :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
        :modifier="m.height(dp(14)).testTag('scroll-line-2')"
      />
      <Text
        text="Hidden row appears after wheel"
        :text-style="{ fontSize: sp(12), color: Color(0xFFB8BDC7) }"
        :modifier="m.height(dp(14)).testTag('scroll-line-3')"
      />
    </Column>
    <Text
      text="Vue SFC authoring, Compose-like layout, JUCE-native target。度尽劫波兄弟在，相逢一笑泯恩仇"
      :text-style="{ fontSize: sp(13), color: Color(0xFFB8BDC7) }"
      :modifier="m.border(dp(1), Color(0xFF4B5563)).testTag('subtitle')"
    />
  </Column>
</template>

<script setup>
import { animateColorAsState, Arrangement, Color, dp, m, rememberScrollState, sp } from "@arrange/runtime"
import { onMounted, onUnmounted, ref } from "vue"

const clicks = ref(0);
const preset = ref("Preset A");
const inputStatus = ref("Input: focus, type, Enter to submit");
const scrollState = rememberScrollState();
const counterColor = animateColorAsState(
  () => clicks.value % 2 === 0 ? Color(0xFF2E7D32) : Color(0xFF3A7AFE),
  { durationMillis: 120 },
);
const rainbowColors = [
  Color(0xFFFF1744),
  Color(0xFFFF9100),
  Color(0xFFFFEA00),
  Color(0xFF00E676),
  Color(0xFF00B0FF),
  Color(0xFF3D5AFE),
  Color(0xFFD500F9),
];
const animeColorTarget = ref(rainbowColors[0]);
const animeColor = animateColorAsState(animeColorTarget, { durationMillis: 520 });
let animeColorFrame = 0;
let animeColorLastSwitch = 0;
let animeColorIndex = 0;
const requestAnimeFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
const cancelAnimeFrame = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null;
function tickAnimeColor(now) {
  if (animeColorLastSwitch === 0) animeColorLastSwitch = now;
  if (now - animeColorLastSwitch >= 620) {
    animeColorLastSwitch = now;
    animeColorIndex = (animeColorIndex + 1) % rainbowColors.length;
    animeColorTarget.value = rainbowColors[animeColorIndex];
  }
  if (requestAnimeFrame) animeColorFrame = requestAnimeFrame(tickAnimeColor);
}
onMounted(() => {
  if (requestAnimeFrame) animeColorFrame = requestAnimeFrame(tickAnimeColor);
});
onUnmounted(() => {
  if (animeColorFrame && cancelAnimeFrame) cancelAnimeFrame(animeColorFrame);
  animeColor.stop?.();
});
function handleTap() {
  clicks.value += 1;
}
function handleSubmit(value) {
  inputStatus.value = `Submitted: ${value}`;
}
function handleChange(value) {
  inputStatus.value = `Changed: ${value}`;
}
function handleBlur(value) {
  inputStatus.value = `Blurred: ${value}`;
}
</script>
