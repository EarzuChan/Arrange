import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const depsDir = resolve(root, "third_party");
const juceDir = resolve(depsDir, "JUCE");
const qjsDir = resolve(depsDir, "quickjs-ng");
const juceRepo = "https://github.com/juce-framework/JUCE.git";
const juceTag = "8.0.12";
const qjsRepo = "https://github.com/quickjs-ng/quickjs.git";
const qjsTag = "v0.14.0";

function run(command, args, options = {}) {
  console.log(`[run] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureCleanPath(path) {
  if (/ArrangeOld|[\\/]_deps[\\/]/i.test(path)) {
    console.error(`[deps] Refusing unclean dependency path: ${path}`);
    process.exit(2);
  }
}

function ensureRepo(name, dir, repo, tag) {
  ensureCleanPath(dir);
  mkdirSync(depsDir, { recursive: true });
  if (!existsSync(resolve(dir, ".git"))) {
    console.log(`[deps] cloning ${name} ${tag} into ${dir}`);
    run("git", ["clone", "--branch", tag, "--depth", "1", "--progress", repo, dir], { timeout: 30 * 60 * 1000 });
    return;
  }
  console.log(`[deps] ${name} checkout exists, fetching tag ${tag}`);
  run("git", ["-C", dir, "fetch", "--depth", "1", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { timeout: 10 * 60 * 1000 });
  run("git", ["-C", dir, "checkout", tag]);
}

ensureRepo("JUCE", juceDir, juceRepo, juceTag);
ensureRepo("QuickJS-NG", qjsDir, qjsRepo, qjsTag);
console.log(`[deps] ready:\n  JUCE_DIR=${juceDir}\n  ARRANGE_QUICKJS_NG_SOURCE_DIR=${qjsDir}`);
