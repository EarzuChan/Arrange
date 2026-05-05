import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DOM_TAG_PATTERN = /<\s*(div|span|input|canvas|button|section|article|main|header|footer)(\s|>|\/)/;
const CLASS_STYLE_PATTERN = /\s(class|style)\s*=/i;
const SFC_STYLE_PATTERN = /<\s*style(\s|>)/i;
const HMR_CLIENT_MARKER = "__ARRANGE_HMR_CLIENT__";
const HOT_EXTENSIONS = new Set([".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const DEV_BUNDLE_PATH = "/@arrange/app.mjs";

function normalizePath(id) {
  return String(id ?? "").split("?")[0].replace(/\\/g, "/");
}

function extensionOf(id) {
  const normalized = normalizePath(id);
  const dot = normalized.lastIndexOf(".");
  return dot < 0 ? "" : normalized.slice(dot);
}

function isEntryModule(id, entry) {
  const normalized = normalizePath(id);
  const normalizedEntry = normalizePath(entry);
  return normalized === normalizedEntry || normalized.endsWith(`/${normalizedEntry}`);
}

function isHotSourceFile(id) {
  const normalized = normalizePath(id);
  if (normalized.includes("/node_modules/")) return false;
  return HOT_EXTENSIONS.has(extensionOf(normalized));
}

function injectHmrClient(code) {
  if (code.includes(HMR_CLIENT_MARKER)) return code;
  return `${code}
import { installArrangeHmrClient as ${HMR_CLIENT_MARKER} } from "@arrange/runtime";
if (import.meta.hot) ${HMR_CLIENT_MARKER}(import.meta.hot);
`;
}

async function importViteApiFromServerRoot(root) {
  const require = createRequire(resolve(root, "package.json"));
  const viteEntry = require.resolve("vite");
  return import(pathToFileURL(viteEntry).href);
}

function outputOfBuildResult(result) {
  if (Array.isArray(result)) return result.flatMap((item) => item.output ?? []);
  return result?.output ?? [];
}

async function buildDevBundle(server, entry) {
  const viteApiRoot = server.config.arrangeViteApiRoot ?? server.config.root;
  const { build, loadConfigFromFile, mergeConfig } = await importViteApiFromServerRoot(viteApiRoot);
  const loaded = server.config.configFile
    ? await loadConfigFromFile({ command: "build", mode: server.config.mode }, server.config.configFile)
    : null;
  const baseConfig = loaded?.config ?? {};
  const buildConfig = mergeConfig(baseConfig, {
    configFile: false,
    root: server.config.root,
    mode: server.config.mode,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      rollupOptions: {
        input: resolve(server.config.root, entry),
        output: {
          format: "es",
          entryFileNames: "app.mjs",
          assetFileNames: "assets/[name]-[hash][extname]",
          codeSplitting: false,
        },
      },
    },
  });

  const result = await build(buildConfig);
  const output = outputOfBuildResult(result);
  const chunk = output.find((item) => item.type === "chunk" && item.fileName === "app.mjs")
    ?? output.find((item) => item.type === "chunk" && item.isEntry);
  if (!chunk?.code) throw new Error("Arrange dev bundle did not produce app.mjs.");
  return chunk.code;
}

export default function arrange(options = {}) {
  const entry = options.entry ?? "src/main.ts";
  const devBundlePath = options.devBundlePath ?? DEV_BUNDLE_PATH;
  return {
    name: "arrange-vite-plugin",
    enforce: "pre",
    config() {
      return {
        server: { host: options.host ?? "127.0.0.1", port: options.port ?? 9178, strictPort: options.strictPort ?? true },
        build: {
          target: "es2022",
          rollupOptions: {
            input: entry,
            output: {
              format: "es",
              entryFileNames: "app.mjs",
              chunkFileNames: "chunks/[name]-[hash].mjs",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
      };
    },
    configureServer(server) {
      server.middlewares.use(devBundlePath, async (_req, res) => {
        try {
          const code = await buildDevBundle(server, entry);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Arrange-Dev-Bundle", "1");
          res.end(code);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(error instanceof Error ? error.stack ?? error.message : String(error));
        }
      });
    },
    handleHotUpdate(ctx) {
      if (!isHotSourceFile(ctx.file)) return ctx.modules;
      ctx.server?.ws?.send?.({
        type: "custom",
        event: "arrange:reload",
        data: {
          path: normalizePath(ctx.file),
          timestamp: Date.now(),
        },
      });
      return [];
    },
    transform(code, id) {
      if (isEntryModule(id, entry)) return injectHmrClient(code);
      if (!id.endsWith(".vue")) return null;
      if (id.includes("?")) return null;
      if (id.endsWith(".vue") && !code.includes("<template")) return null;
      const warnings = [];
      if (DOM_TAG_PATTERN.test(code)) warnings.push("Arrange does not render DOM/HTML tags; use Box/Row/Column/Text/Input/Canvas etc.");
      if (CLASS_STYLE_PATTERN.test(code)) warnings.push("Arrange ignores class/style attributes; use modifier instead.");
      if (SFC_STYLE_PATTERN.test(code)) warnings.push("Arrange ignores SFC <style>; use Modifier and theme tokens instead.");
      for (const message of warnings) this.warn({ id, message });
      return null;
    },
  };
}

export { arrange };
export { DEV_BUNDLE_PATH, buildDevBundle };

