import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const buildDir = resolve(root, "build/native-smoke");
const vcvars = process.env.VC_VCVARS64 ?? "D:\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat";
if (!existsSync(vcvars)) {
  console.error(`[native] vcvars64.bat not found: ${vcvars}`);
  process.exit(2);
}
mkdirSync(buildDir, { recursive: true });

function run(command, args) {
  console.log(`[run] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["tests/fixtures/bridge/write-basic-fixture.mjs"]);

const includeArgs = [
  "/I", "native\\arrange_core\\include",
  "/I", "native\\arrange_juce\\include",
  "/I", "native\\arrange_quickjs\\include",
];
const sources = [
  "cpp_tests\\arrange_core_smoke.cpp",
  "native\\arrange_core\\src\\Version.cpp",
  "native\\arrange_core\\src\\PropValue.cpp",
  "native\\arrange_core\\src\\TextLayoutService.cpp",
  "native\\arrange_core\\src\\Bridge.cpp",
  "native\\arrange_core\\src\\RenderTree.cpp",
  "native\\arrange_core\\src\\Modifier.cpp",
  "native\\arrange_core\\src\\Layout.cpp",
  "native\\arrange_core\\src\\HitTest.cpp",
  "native\\arrange_core\\src\\PointerDispatcher.cpp",
  "native\\arrange_core\\src\\Scroll.cpp",
  "native\\arrange_core\\src\\InputEditing.cpp",
  "native\\arrange_core\\src\\Paint.cpp",
  "native\\arrange_juce\\src\\AppResolver.cpp",
  "native\\arrange_juce\\src\\DevServerClient.cpp",
  "native\\arrange_juce\\src\\ErrorScreenModel.cpp",
  "native\\arrange_juce\\src\\HeadlessArrangeEditor.cpp",
  "native\\arrange_quickjs\\src\\AppScriptLoader.cpp",
  "native\\arrange_quickjs\\src\\CallbackRegistry.cpp",
];
const cmdPath = resolve(buildDir, "compile-native-smoke.cmd");
const compileLine = `cl /nologo /std:c++20 /EHsc ${includeArgs.join(" ")} ${sources.join(" ")} /Fo:build\\native-smoke\\ /Fe:build\\native-smoke\\arrange_core_smoke.exe`;
writeFileSync(cmdPath, `@echo off\r\ncall "${vcvars}"\r\nif errorlevel 1 exit /b %errorlevel%\r\n${compileLine}\r\nexit /b %errorlevel%\r\n`);
run("cmd.exe", ["/d", "/c", cmdPath]);
run("build\\native-smoke\\arrange_core_smoke.exe", ["build\\fixtures\\bridge\\basic-tree.bridge.bin"]);
console.log("[native] smoke passed");
