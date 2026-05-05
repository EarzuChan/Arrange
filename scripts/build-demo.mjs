import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const buildType = process.env.ARRANGE_DEMO_BUILD_TYPE ?? "Release";
const buildDir = `build\\demo-nmake-${buildType.toLowerCase()}`;
const cmake = process.env.CMAKE_EXE ?? "D:\\Microsoft Visual Studio\\18\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe";
const vcvars = process.env.VC_VCVARS64 ?? "D:\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat";
const juceDir = process.env.JUCE_DIR ?? resolve(root, "third_party/JUCE");
const qjsDir = process.env.ARRANGE_QUICKJS_NG_SOURCE_DIR ?? resolve(root, "third_party/quickjs-ng");

for (const p of [cmake, vcvars, juceDir]) {
  if (!existsSync(p)) {
    console.error(`[demo] Missing required path: ${p}`);
    console.error("Run `node scripts/prepare-deps.mjs` first, or provide clean JUCE_DIR.");
    process.exit(2);
  }
}

if (/ArrangeOld|[\\/]_deps[\\/]/i.test(juceDir) || /ArrangeOld|[\\/]_deps[\\/]/i.test(qjsDir)) {
  console.error("[demo] Refusing ArrangeOld/_deps dependency path.");
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

const configure = `call "${vcvars}" >nul && "${cmake}" -S . -B ${buildDir} -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=${buildType} -DARRANGE_BUILD_DEMO=ON -DARRANGE_BUILD_TESTS=OFF -DARRANGE_WITH_QUICKJS_NG=ON -DJUCE_DIR="${juceDir}" -DARRANGE_QUICKJS_NG_SOURCE_DIR="${qjsDir}"`;
const build = `call "${vcvars}" >nul && "${cmake}" --build ${buildDir} --config ${buildType}`;
runCmdLine(configure, 5 * 60 * 1000);
runCmdLine(build, 20 * 60 * 1000);
console.log("[demo] build finished");
