import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import arrange, { buildDevBundle, DEV_BUNDLE_PATH } from "../../packages/vite-plugin/src/index.mjs";

test("vite plugin config freezes Arrange dev server and app.mjs output defaults", () => {
  const plugin = arrange();
  const config = plugin.config();
  assert.deepEqual(config.server, { host: "127.0.0.1", port: 9178, strictPort: true });
  assert.equal(config.build.rollupOptions.input, "src/main.ts");
  assert.equal(config.build.rollupOptions.output.entryFileNames, "app.mjs");
  assert.equal(config.build.rollupOptions.output.chunkFileNames, "chunks/[name]-[hash].mjs");
});

test("vite plugin registers an app.mjs dev bundle endpoint for native ArrangeEditor", () => {
  const plugin = arrange();
  const registrations = [];
  plugin.configureServer({
    middlewares: {
      use(path, handler) {
        registrations.push({ path, handler });
      },
    },
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].path, DEV_BUNDLE_PATH);
  assert.equal(typeof registrations[0].handler, "function");
});

test("vite plugin can build the native dev app.mjs bundle on demand", { timeout: 15000 }, async () => {
  const root = resolve("demo/ui-src");
  const code = await buildDevBundle({
    config: {
      root,
      mode: "development",
      configFile: resolve(root, "vite.config.mjs"),
    },
  }, "src/main.ts");
  assert.match(code, /__ARRANGE_NATIVE__/);
  assert.match(code, /createApp/);
});

test("vite plugin injects Arrange HMR client into the configured entry", () => {
  const plugin = arrange();
  const transformed = plugin.transform.call({ warn() {} }, 'import { createApp } from "@arrange/runtime";\n', "C:/demo/ui-src/src/main.ts");
  assert.match(transformed, /installArrangeHmrClient/);
  assert.match(transformed, /import\.meta\.hot/);
});

test("vite plugin emits Arrange reload events over Vite HMR channel", () => {
  const plugin = arrange();
  const sent = [];
  const modules = [{ id: "App.vue" }];
  const result = plugin.handleHotUpdate({
    file: "C:\\demo\\ui-src\\src\\App.vue",
    modules,
    server: { ws: { send(event) { sent.push(event); } } },
  });
  assert.deepEqual(result, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "custom");
  assert.equal(sent[0].event, "arrange:reload");
  assert.equal(sent[0].data.path, "C:/demo/ui-src/src/App.vue");
  assert.equal(typeof sent[0].data.timestamp, "number");
});

test("vite plugin suppresses component-level HMR so native reload owns state cleanup", () => {
  const plugin = arrange();
  const sent = [];
  const result = plugin.handleHotUpdate({
    file: "C:/demo/ui-src/src/Counter.vue",
    modules: [{ id: "Counter.vue" }, { id: "Counter.vue?type=script" }],
    server: { ws: { send(event) { sent.push(event); } } },
  });

  assert.deepEqual(result, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, "arrange:reload");
});

test("vite plugin does not emit Arrange reload for dependency updates", () => {
  const plugin = arrange();
  const sent = [];
  plugin.handleHotUpdate({
    file: "C:/demo/ui-src/node_modules/vue/index.mjs",
    modules: [],
    server: { ws: { send(event) { sent.push(event); } } },
  });
  assert.deepEqual(sent, []);
});

test("vite plugin warns for DOM tags, class/style, and SFC style blocks", () => {
  const plugin = arrange();
  const warnings = [];
  const context = { warn(warning) { warnings.push(warning.message); } };
  plugin.transform.call(context, '<template><div class="x" style="color:red">bad</div></template><style>.x{}</style>', 'App.vue');
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /DOM\/HTML/);
  assert.match(warnings[1], /class\/style/);
  assert.match(warnings[2], /SFC <style>/);
});

test("vite plugin accepts Arrange component template without warnings", () => {
  const plugin = arrange();
  const warnings = [];
  plugin.transform.call({ warn(warning) { warnings.push(warning.message); } }, '<template><Column><Text text="ok" /><Input placeholder="ok" /></Column></template>', 'App.vue');
  assert.deepEqual(warnings, []);
});
