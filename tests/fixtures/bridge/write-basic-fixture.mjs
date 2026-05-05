import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Column, Text, Box, m, dp, Color, encodeBridgeBatch } from "../../../packages/runtime/src/index.mjs";
import { h, renderToBridgeOps } from "../../../packages/runtime/src/test/index.mjs";

const out = resolve(process.argv[2] ?? "build/fixtures/bridge/basic-tree.bridge.bin");
const jsonOut = out.replace(/\.bin$/, ".ops.json");

const ops = renderToBridgeOps(() => h(Column, { modifier: m.padding(dp(8)).testTag("root") }, [
  h(Text, { text: "Hello from JS fixture", textStyle: { fontSize: 18, color: Color(0xFFE8EAED) }, modifier: m.testTag("title") }),
  h(Box, { modifier: m.size(dp(16), dp(8)).background(Color(0xFF112233)).clickable(() => {}).testTag("box") }),
]));

const bytes = encodeBridgeBatch(ops);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, bytes);
await writeFile(jsonOut, JSON.stringify({ ops }, null, 2));
console.log(JSON.stringify({ out, jsonOut, byteLength: bytes.byteLength, opCount: ops.length }, null, 2));


