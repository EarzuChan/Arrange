import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const uiPackageDir = resolve(root, "demo/ui-src");
const uiOutDir = resolve(root, "demo/plugin-src/ui");
const appEntry = resolve(uiOutDir, "app.mjs");
const bridgeOut = resolve(uiOutDir, "app.bridge.bin");

function run(command, args, options = {}) {
  console.log(`[run] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, stdio: "inherit", shell: false, timeout: options.timeout ?? 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("cmd.exe", ["/d", "/c", "pnpm", "install"], { timeout: 5 * 60_000 });
run("cmd.exe", ["/d", "/c", "pnpm", "build"], { cwd: uiPackageDir, timeout: 5 * 60_000 });

const { encodeBridgeBatch } = await import("../packages/runtime/src/index.mjs");
const { renderToBridgeOps } = await import("../packages/runtime/src/test/index.mjs");

let mountedTree = null;
globalThis.__ARRANGE_NATIVE__ = {
  commit(batch) {
    for (const op of batch) {
      if (op.op === "mount") mountedTree = op.tree;
    }
  },
};

await import(`${pathToFileURL(appEntry).href}?t=${Date.now()}`);

if (!mountedTree) {
  console.error("[demo-ui] app.mjs did not mount an Arrange tree");
  process.exit(2);
}

const ops = renderToBridgeOps(mountedTree);
const bytes = encodeBridgeBatch(ops);
mkdirSync(uiOutDir, { recursive: true });
writeFileSync(bridgeOut, bytes);
console.log(JSON.stringify({ appEntry, bridgeOut, opCount: ops.length, byteLength: bytes.byteLength }, null, 2));
