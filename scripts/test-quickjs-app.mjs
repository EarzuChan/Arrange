import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildDevBundle } from "../packages/vite-plugin/src/index.mjs";

const root = resolve(import.meta.dirname, "..");
const buildDir = "build\\quickjs-smoke";
const cmake = process.env.CMAKE_EXE ?? "D:\\Microsoft Visual Studio\\18\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe";
const vcvars = process.env.VC_VCVARS64 ?? "D:\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat";
const qjsDir = process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR ?? resolve(root, "third_party/quickjs-ng");
const moduleFixtureDir = resolve(root, "build/quickjs-module-fixture/ui");
const callbackFixtureDir = resolve(root, "build/quickjs-callback-fixture/ui");
const callbackReplaceFixtureDir = resolve(root, "build/quickjs-callback-replace-fixture/ui");
const callbackPropDeleteFixtureDir = resolve(root, "build/quickjs-callback-prop-delete-fixture/ui");
const callbackUnmountFixtureDir = resolve(root, "build/quickjs-callback-unmount-fixture/ui");
const inputFixtureDir = resolve(root, "build/quickjs-input-fixture/ui");
const protocolFixtureDir = resolve(root, "build/quickjs-protocol-fixture/ui");
const reloadFixtureDir = resolve(root, "build/quickjs-reload-fixture/ui");
const devBundleFixtureDir = resolve(root, "build/quickjs-dev-bundle-fixture/ui");
const hmrFixtureRoot = resolve(root, "build/quickjs-hmr-vite-fixture");
const hmrAFixtureDir = resolve(root, "build/quickjs-hmr-a-fixture/ui");
const hmrBFixtureDir = resolve(root, "build/quickjs-hmr-b-fixture/ui");
const hmrRecoveryFixtureDir = resolve(root, "build/quickjs-hmr-recovery-fixture/ui");
const vModelFixtureDir = resolve(root, "build/quickjs-vmodel-fixture/ui");
const scrollFixtureDir = resolve(root, "build/quickjs-scroll-fixture/ui");
const animationFixtureDir = resolve(root, "build/quickjs-animation-fixture/ui");

for (const p of [cmake, vcvars, qjsDir, resolve(root, "demo/plugin-src/ui/app.mjs")]) {
  if (!existsSync(p)) {
    console.error(`[quickjs-smoke] Missing required path: ${p}`);
    process.exit(2);
  }
}

if (/ArrangeOld|[\\/]_deps[\\/]/i.test(qjsDir)) {
  console.error("[quickjs-smoke] Refusing ArrangeOld/_deps QuickJS dependency path.");
  process.exit(2);
}

function runCmdLine(line, timeout) {
  const scriptDir = resolve(root, buildDir);
  mkdirSync(scriptDir, { recursive: true });
  const scriptPath = resolve(scriptDir, "run-step.cmd");
  writeFileSync(scriptPath, `@echo off\r\n${line}\r\nexit /b %errorlevel%\r\n`);
  console.log(`[run] ${line}`);
  const result = spawnSync("cmd.exe", ["/d", "/c", scriptPath], { cwd: root, stdio: "inherit", shell: false, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const configure = `call "${vcvars}" >nul && "${cmake}" -S . -B ${buildDir} -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Debug -DARRANGE_WITH_QUICKJS_NG=ON -DARRANGE_BUILD_TESTS=ON -DARRANGE_BUILD_DEMO=OFF -DARRANGE_QUICKJS_NG_SOURCE_DIR="${qjsDir}"`;
const build = `call "${vcvars}" >nul && "${cmake}" --build ${buildDir} --target arrange_quickjs_app_smoke --config Debug`;
const run = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe demo\\plugin-src\\ui\\app.mjs`;
const runDemoCallback = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe demo\\plugin-src\\ui\\app.mjs 1 "Clicks: 1"`;
const runModuleFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-module-fixture\\ui\\app.mjs`;
const runCallbackFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-callback-fixture\\ui\\app.mjs 1 clicked`;
const runCallbackReplaceFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-callback-replace-fixture\\ui\\app.mjs --expect-callback-count 2 1 swapped --expect-callback-count-after-invoke 2 --expect-callback-fails 1 --invoke-after 3 second`;
const runCallbackPropDeleteFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-callback-prop-delete-fixture\\ui\\app.mjs --expect-callback-count 1 1 "prop swapped" typed --expect-callback-count-after-invoke 1 --expect-callback-fails 1 --invoke-after 2 "prop second" typed --expect-callback-count-after-invoke 0`;
const runCallbackUnmountFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-callback-unmount-fixture\\ui\\app.mjs --expect-callback-count 2 --invoke-unmount 1 --expect-callback-count 0`;
const runInputFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-input-fixture\\ui\\app.mjs 1 typed typed`;
const runProtocolFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-protocol-fixture\\ui\\app.mjs --expect-text "protocol 1"`;
const runReloadFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-reload-fixture\\ui\\app.mjs --expect-reload "src/App.vue"`;
const runCallbackResetFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-callback-fixture\\ui\\app.mjs --expect-callback-count 2 --reload-entry build\\quickjs-protocol-fixture\\ui\\app.mjs --expect-callback-count 0`;
const runDevBundleFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-dev-bundle-fixture\\ui\\app.mjs`;
const runHmrAFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-hmr-a-fixture\\ui\\app.mjs --expect-text "hmr A"`;
const runHmrBFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-hmr-b-fixture\\ui\\app.mjs --expect-text "hmr B"`;
const runHmrRecoveryFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-hmr-recovery-fixture\\ui\\app.mjs --expect-text "hmr recovered"`;
const runVModelFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-vmodel-fixture\\ui\\app.mjs 1 typed typed`;
const runScrollFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-scroll-fixture\\ui\\app.mjs 1 --no-mounted-batch "{\\"value\\":7,\\"maxValue\\":12,\\"viewportSize\\":4,\\"contentSize\\":16}"`;
const runAnimationFixture = `call "${vcvars}" >nul && ${buildDir}\\cpp_tests\\arrange_quickjs_app_smoke.exe build\\quickjs-animation-fixture\\ui\\app.mjs --set-frame-time 0 1 armed --expect-pending-raf --pump-frame 50 --expect-background-color 0xff808080 --expect-pending-raf --pump-frame 100 --expect-background-color 0xffffffff`;

mkdirSync(resolve(moduleFixtureDir, "chunks"), { recursive: true });
writeFileSync(resolve(moduleFixtureDir, "chunks/message.mjs"), `export const message = "module loader text";\n`);
writeFileSync(resolve(moduleFixtureDir, "app.mjs"), `import { message } from "./chunks/message.mjs";
globalThis.__ARRANGE_NATIVE__.commit([{
  op: "mount",
  tree: {
    type: "Column",
    props: { modifier: { elements: [] } },
    children: [
      { type: "Text", props: { text: message, modifier: { elements: [] } }, children: [] },
      { type: "Box", props: { modifier: { elements: [] } }, children: [] }
    ]
  }
}]);
`);

mkdirSync(callbackFixtureDir, { recursive: true });
writeFileSync(resolve(callbackFixtureDir, "app.mjs"), `let clicked = false;
function commit() {
  globalThis.__ARRANGE_NATIVE__.commit([{
    op: "mount",
    tree: {
      type: "Column",
      props: { modifier: { elements: [] } },
      children: [
        {
          type: "Box",
          props: {
            modifier: {
              elements: [
                { type: "size", value: { width: 100, height: 40 } },
                { type: "clickable", value: { enabled: true, focusable: true, onClick: () => { clicked = true; commit(); } } }
              ]
            }
          },
          children: []
        },
        { type: "Text", props: { text: clicked ? "clicked" : "idle", modifier: { elements: [] } }, children: [] }
      ]
    }
  }]);
}
commit();
`);

mkdirSync(callbackReplaceFixtureDir, { recursive: true });
writeFileSync(resolve(callbackReplaceFixtureDir, "app.mjs"), `let label = "idle";
function second() {
  label = "second";
  globalThis.__ARRANGE_NATIVE__.commit([
    { op: "setText", id: 2, text: label }
  ]);
}
function first() {
  label = "swapped";
  globalThis.__ARRANGE_NATIVE__.commit([
    {
      op: "setModifier",
      id: 1,
      modifier: {
        elements: [
          { type: "size", value: { width: 100, height: 40 } },
          { type: "clickable", value: { enabled: true, focusable: true, onClick: second } }
        ]
      }
    },
    { op: "setText", id: 2, text: label }
  ]);
}
globalThis.__ARRANGE_NATIVE__.commit([{
  op: "mount",
  tree: {
    type: "Box",
    props: {
      modifier: {
        elements: [
          { type: "size", value: { width: 100, height: 40 } },
          { type: "clickable", value: { enabled: true, focusable: true, onClick: first } }
        ]
      }
    },
    children: [
      { type: "Text", props: { text: label, modifier: { elements: [] } }, children: [] }
    ]
  }
}]);
`);

mkdirSync(callbackPropDeleteFixtureDir, { recursive: true });
writeFileSync(resolve(callbackPropDeleteFixtureDir, "app.mjs"), `let label = "prop idle";
function second(next) {
  label = "prop second";
  globalThis.__ARRANGE_NATIVE__.commit([
    { op: "deleteNode", id: 2 },
    { op: "setText", id: 3, text: label }
  ]);
}
function first(next) {
  label = "prop swapped";
  globalThis.__ARRANGE_NATIVE__.commit([
    { op: "setProp", id: 2, key: "onUpdate:modelValue", value: second },
    { op: "setText", id: 3, text: label }
  ]);
}
globalThis.__ARRANGE_NATIVE__.commit([{
  op: "mount",
  tree: {
    type: "Column",
    props: { modifier: { elements: [] } },
    children: [
      {
        type: "Input",
        props: {
          modelValue: "value",
          "onUpdate:modelValue": first,
          modifier: { elements: [] }
        },
        children: []
      },
      { type: "Text", props: { text: label, modifier: { elements: [] } }, children: [] }
    ]
  }
}]);
`);

mkdirSync(callbackUnmountFixtureDir, { recursive: true });
writeFileSync(resolve(callbackUnmountFixtureDir, "app.mjs"), `function unmount() {
  globalThis.__ARRANGE_NATIVE__.commit([{ op: "unmount" }]);
}
globalThis.__ARRANGE_NATIVE__.commit([{
  op: "mount",
  tree: {
    type: "Box",
    props: {
      modifier: {
        elements: [
          { type: "size", value: { width: 100, height: 40 } },
          { type: "clickable", value: { enabled: true, focusable: true, onClick: unmount } }
        ]
      }
    },
    children: [
      { type: "Text", props: { text: "mounted", modifier: { elements: [] } }, children: [] }
    ]
  }
}]);
`);

mkdirSync(inputFixtureDir, { recursive: true });
writeFileSync(resolve(inputFixtureDir, "app.mjs"), `let value = "idle";
function update(next) {
  value = next;
  commit();
}
function commit() {
  globalThis.__ARRANGE_NATIVE__.commit([{
    op: "mount",
    tree: {
      type: "Column",
      props: { modifier: { elements: [] } },
      children: [
        {
          type: "Input",
          props: {
            modelValue: value,
            placeholder: "type here",
            "onUpdate:modelValue": update,
            modifier: { elements: [] }
          },
          children: []
        },
        { type: "Text", props: { text: value, modifier: { elements: [] } }, children: [] }
      ]
    }
  }]);
}
commit();
`);

mkdirSync(protocolFixtureDir, { recursive: true });
writeFileSync(resolve(protocolFixtureDir, "app.mjs"), `const version = globalThis.__ARRANGE_NATIVE__.protocolVersion;
globalThis.__ARRANGE_NATIVE__.commit([{
  op: "mount",
  tree: {
    type: "Column",
    props: { modifier: { elements: [] } },
    children: [
      { type: "Text", props: { text: "protocol " + version, modifier: { elements: [] } }, children: [] }
    ]
  }
}]);
`);

mkdirSync(reloadFixtureDir, { recursive: true });
writeFileSync(resolve(reloadFixtureDir, "app.mjs"), `globalThis.__ARRANGE_NATIVE__.reload({ path: "src/App.vue", timestamp: 123 });
globalThis.__ARRANGE_NATIVE__.commit([{
  op: "mount",
  tree: {
    type: "Column",
    props: { modifier: { elements: [] } },
    children: [
      { type: "Text", props: { text: "reload requested", modifier: { elements: [] } }, children: [] }
    ]
  }
}]);
`);

mkdirSync(devBundleFixtureDir, { recursive: true });
const demoUiRoot = resolve(root, "demo/ui-src");
const devBundle = await buildDevBundle({
  config: {
    root: demoUiRoot,
    mode: "development",
    configFile: resolve(demoUiRoot, "vite.config.mjs"),
  },
}, "src/main.ts");
writeFileSync(resolve(devBundleFixtureDir, "app.mjs"), devBundle);
const demoLogo = resolve(demoUiRoot, "public/logo.png");
if (existsSync(demoLogo)) copyFileSync(demoLogo, resolve(devBundleFixtureDir, "logo.png"));

const demoRequire = createRequire(resolve(demoUiRoot, "package.json"));
const pluginVueUrl = pathToFileURL(demoRequire.resolve("@vitejs/plugin-vue")).href;
const vueUrl = pathToFileURL(demoRequire.resolve("vue")).href;
const arrangePluginUrl = pathToFileURL(resolve(root, "packages/vite-plugin/src/index.mjs")).href;
const runtimeUrl = pathToFileURL(resolve(root, "packages/runtime/src/index.mjs")).href;
mkdirSync(resolve(hmrFixtureRoot, "src"), { recursive: true });
writeFileSync(resolve(hmrFixtureRoot, "package.json"), `{"type":"module","private":true}\n`);
writeFileSync(resolve(hmrFixtureRoot, "src/main.ts"), `import { createApp } from "@arrange/runtime";
import App from "./App.vue";
createApp(App).mount();
`);
writeFileSync(resolve(hmrFixtureRoot, "vite.config.mjs"), `import vue from ${JSON.stringify(pluginVueUrl)};
import arrange from ${JSON.stringify(arrangePluginUrl)};

export default {
  plugins: [arrange({ entry: "src/main.ts" }), vue()],
  resolve: {
    alias: {
      "@arrange/runtime": ${JSON.stringify(runtimeUrl)},
      "vue": ${JSON.stringify(vueUrl)}
    }
  }
};
`);

function writeHmrApp(text) {
  writeFileSync(resolve(hmrFixtureRoot, "src/App.vue"), `<template>
  <Column>
    <Text text="${text}" />
  </Column>
</template>

<script setup>
import { Column, Text } from "@arrange/runtime";
</script>
`);
}

async function buildHmrBundle(outDir, text) {
  writeHmrApp(text);
  mkdirSync(outDir, { recursive: true });
  const code = await buildDevBundle({
    config: {
      root: hmrFixtureRoot,
      mode: "development",
      configFile: resolve(hmrFixtureRoot, "vite.config.mjs"),
      arrangeViteApiRoot: demoUiRoot,
    },
  }, "src/main.ts");
  writeFileSync(resolve(outDir, "app.mjs"), code);
}

await buildHmrBundle(hmrAFixtureDir, "hmr A");
await buildHmrBundle(hmrBFixtureDir, "hmr B");
writeFileSync(resolve(hmrFixtureRoot, "src/App.vue"), `<template><Column><Text text="broken"></Column></template>`);
let sawBrokenHmrBuild = false;
try {
  await buildDevBundle({
    config: {
      root: hmrFixtureRoot,
      mode: "development",
      configFile: resolve(hmrFixtureRoot, "vite.config.mjs"),
      arrangeViteApiRoot: demoUiRoot,
    },
  }, "src/main.ts");
} catch {
  sawBrokenHmrBuild = true;
}
if (!sawBrokenHmrBuild) {
  console.error("[quickjs-smoke] Expected broken HMR SFC build to fail.");
  process.exit(1);
}
await buildHmrBundle(hmrRecoveryFixtureDir, "hmr recovered");

writeFileSync(resolve(hmrFixtureRoot, "src/App.vue"), `<template>
  <Column>
    <Input v-model="value" />
    <Text :text="value" />
  </Column>
</template>

<script setup>
import { ref } from "vue";
import { Column, Input, Text } from "@arrange/runtime";
const value = ref("idle");
</script>
`);
mkdirSync(vModelFixtureDir, { recursive: true });
const vModelCode = await buildDevBundle({
  config: {
    root: hmrFixtureRoot,
    mode: "development",
    configFile: resolve(hmrFixtureRoot, "vite.config.mjs"),
    arrangeViteApiRoot: demoUiRoot,
  },
}, "src/main.ts");
writeFileSync(resolve(vModelFixtureDir, "app.mjs"), vModelCode);

writeFileSync(resolve(hmrFixtureRoot, "src/App.vue"), `<template>
  <Column :modifier="m.verticalScroll(scrollState)">
    <Text :text="'scroll ' + scrollState.value" />
  </Column>
</template>

<script setup>
import { Column, Text, m, rememberScrollState } from "@arrange/runtime";
const scrollState = rememberScrollState();
</script>
`);
mkdirSync(scrollFixtureDir, { recursive: true });
const scrollCode = await buildDevBundle({
  config: {
    root: hmrFixtureRoot,
    mode: "development",
    configFile: resolve(hmrFixtureRoot, "vite.config.mjs"),
    arrangeViteApiRoot: demoUiRoot,
  },
}, "src/main.ts");
writeFileSync(resolve(scrollFixtureDir, "app.mjs"), scrollCode);

writeFileSync(resolve(hmrFixtureRoot, "src/App.vue"), `<template>
  <Box :modifier="m.size(100, 40).background(color).clickable(arm)">
    <Text :text="open ? 'armed' : 'idle'" />
  </Box>
</template>

<script setup>
import { computed, ref } from "vue";
import { Box, Text, m, animateColorAsState } from "@arrange/runtime";
const open = ref(false);
const targetColor = computed(() => open.value ? 0xffffffff : 0xff000000);
const color = animateColorAsState(targetColor, { durationMillis: 100 });
function arm() {
  open.value = true;
}
</script>
`);
mkdirSync(animationFixtureDir, { recursive: true });
const animationCode = await buildDevBundle({
  config: {
    root: hmrFixtureRoot,
    mode: "development",
    configFile: resolve(hmrFixtureRoot, "vite.config.mjs"),
    arrangeViteApiRoot: demoUiRoot,
  },
}, "src/main.ts");
writeFileSync(resolve(animationFixtureDir, "app.mjs"), animationCode);

runCmdLine(configure, 5 * 60 * 1000);
runCmdLine(build, 10 * 60 * 1000);
runCmdLine(run, 60 * 1000);
runCmdLine(runDemoCallback, 60 * 1000);
runCmdLine(runModuleFixture, 60 * 1000);
runCmdLine(runCallbackFixture, 60 * 1000);
runCmdLine(runCallbackReplaceFixture, 60 * 1000);
runCmdLine(runCallbackPropDeleteFixture, 60 * 1000);
runCmdLine(runCallbackUnmountFixture, 60 * 1000);
runCmdLine(runInputFixture, 60 * 1000);
runCmdLine(runProtocolFixture, 60 * 1000);
runCmdLine(runReloadFixture, 60 * 1000);
runCmdLine(runCallbackResetFixture, 60 * 1000);
runCmdLine(runDevBundleFixture, 60 * 1000);
runCmdLine(runHmrAFixture, 60 * 1000);
runCmdLine(runHmrBFixture, 60 * 1000);
runCmdLine(runHmrRecoveryFixture, 60 * 1000);
runCmdLine(runVModelFixture, 60 * 1000);
runCmdLine(runScrollFixture, 60 * 1000);
runCmdLine(runAnimationFixture, 60 * 1000);
console.log("[quickjs-smoke] passed");
