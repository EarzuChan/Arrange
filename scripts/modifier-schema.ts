import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { modifierSchema } from "../packages/shared/src/modifierSchema.ts"

const outputPath = fileURLToPath(new URL("../native/arrange_quickjs/src/ModifierSchema.inc", import.meta.url))

// 原生修饰白名单与回调种类表，由修饰 schema 生成；解析逻辑仍在 QuickJsModifierReader 手写
export function renderModifierSchema(): string {
    const lines = ["// 由 scripts/modifier-schema.ts 依 @arrange/shared 修饰 schema 生成，勿手改", ""]
    const entries: string[] = []
    for (const [type, entry] of Object.entries(modifierSchema)) {
        const fields = entry.fields.length ? `${type}Fields` : "{}"
        if (entry.fields.length) lines.push(`inline constexpr std::string_view ${type}Fields[]{${entry.fields.map(field => `"${field}"`).join(", ")}};`)
        const events = Object.entries(entry.events ?? {})
        const callbacks = events.length ? `${type}Callbacks` : "{}"
        if (events.length) lines.push(`inline constexpr ModifierCallbackField ${type}Callbacks[]{${events.map(([field, kind]) => `{"${field}", arrange::core::EventSlotKind::${kind[0].toUpperCase()}${kind.slice(1)}}`).join(", ")}};`)
        entries.push(`    {"${type}", ${fields}, ${callbacks}},`)
    }
    lines.push("", "inline constexpr ModifierSchemaEntry modifierSchemaEntries[]{", ...entries, "};", "")
    return lines.join("\n")
}

export function syncModifierSchema(): void {
    writeFileSync(outputPath, renderModifierSchema())
}

export function assertModifierSchema(): void {
    if (readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") !== renderModifierSchema()) throw new Error("ModifierSchema.inc 与修饰 schema 不一致，请运行 pnpm sync:modifier-schema")
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    if (process.argv.includes("--check")) {
        assertModifierSchema()
        console.log("[ModifierSchema]", "verified native modifier schema")
    } else {
        syncModifierSchema()
        console.log("[ModifierSchema]", "synced native modifier schema")
    }
}
