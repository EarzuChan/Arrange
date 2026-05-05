import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const productionRoots = [
    "native/arrange_core/include",
    "native/arrange_core/src",
    "native/arrange_juce/src",
    "packages/runtime/src",
];

const allowedModifierDebugJson = new Set([
    "native/arrange_core/include/arrange/core/Bridge.h",
    "native/arrange_core/include/arrange/core/Node.h",
    "native/arrange_core/src/Bridge.cpp",
    "native/arrange_core/src/RenderTree.cpp",
]);

const allowedParserFiles = new Set([
    "native/arrange_core/include/arrange/core/PropValue.h",
    "native/arrange_core/src/PropValue.cpp",
]);

function listFiles(dir) {
    const result = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) result.push(...listFiles(full));
        else if (/\.(h|cpp|mjs|ts|js)$/.test(name)) result.push(full);
    }
    return result;
}

const violations = [];
for (const rootDir of productionRoots) {
    for (const file of listFiles(join(root, rootDir))) {
        const rel = relative(root, file).replaceAll("\\", "/");
        const text = readFileSync(file, "utf8");
        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
            const location = `${rel}:${index + 1}`;
            if (line.includes("element.body")) violations.push(`${location}: ModifierElement body string access is forbidden`);
            if (line.includes("typedModifierBody")) violations.push(`${location}: typed modifier JSON/string body generation is forbidden`);
            if (line.includes("modifierDebugJson") && !allowedModifierDebugJson.has(rel)) violations.push(`${location}: modifierDebugJson is not allowed in production modules`);
            if (/parse(Number|Bool|String|Handle)After\s*\(/.test(line) && !allowedParserFiles.has(rel)) violations.push(`${location}: ad-hoc parser use is forbidden outside PropValue`);
            if (/containsJsonType\s*\(/.test(line) && !allowedParserFiles.has(rel)) violations.push(`${location}: JSON type string scan is forbidden outside PropValue`);
        });
    }
}

if (violations.length > 0) {
    console.error("[p0-contract] violations:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
}

console.log("[p0-contract] passed");
