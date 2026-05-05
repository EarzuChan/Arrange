import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function run(command, args) {
  console.log(`[run] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["--test", "tests/**/*.test.mjs"]);
run(process.execPath, ["scripts/verify-p0-contract.mjs"]);
run(process.execPath, ["scripts/build-demo-ui.mjs"]);
run(process.execPath, ["tests/smoke/basic-editor-smoke.mjs"]);
run(process.execPath, ["scripts/test-native.mjs"]);
run(process.execPath, ["scripts/test-quickjs-app.mjs"]);
console.log("[verify] M1 slice verification passed");
