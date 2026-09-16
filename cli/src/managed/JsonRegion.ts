import {errorMessage} from "../util/Utils.ts"
import {isDeepStrictEqual} from "node:util"
import {isManagedItem, type ProjectState} from "../project/ProjectState.ts"
import {type CheckResult} from "./CheckResult.ts"

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue}
export type JsonPath = readonly (string | number)[]
// undefined 专指字段不存在，与 JSON null 区分。
export type JsonExpected = JsonValue | undefined

export function readJsonPath(json: JsonValue, path: JsonPath): JsonExpected {
    let current: JsonExpected = json
    for (const key of path) {
        if (current === undefined) return undefined
        const valid = typeof key === "number" ? Array.isArray(current) : current !== null && typeof current === "object" && !Array.isArray(current)
        if (!valid) throw new Error(`路径 ${JSON.stringify(path)} 在 ${String(key)} 前需要${typeof key === "number" ? "数组" : "对象"}，实际为 ${JSON.stringify(current)}`)
        current = Object.hasOwn(current as object, key) ? (current as Record<string | number, JsonValue>)[key] : undefined
    }

    return current
}

export function setJsonPath(json: JsonValue, path: JsonPath, value: JsonExpected): void {
    readJsonPath(json, path)

    let current = json as Record<string | number, JsonValue>
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]
        if (!Object.hasOwn(current, key)) {
            if (value === undefined) return
            Object.defineProperty(current, key, {value: typeof path[i + 1] === "number" ? [] : {}, enumerable: true, writable: true, configurable: true})
        }
        current = current[key] as Record<string | number, JsonValue>
    }

    const key = path[path.length - 1]
    if (value === undefined) {
        if (Array.isArray(current) && typeof key === "number") current.splice(key, 1)
        else delete current[key]
    } else Object.defineProperty(current, key, {value: structuredClone(value), enumerable: true, writable: true, configurable: true})
}

export class JsonRegion {
    readonly kind = "json-region"

    constructor(readonly id: string, readonly managedItemId: string, private readonly path: JsonPath, private readonly value: (state: ProjectState) => JsonExpected) {
        if (path.length === 0 || path.some(key => typeof key === "number" && (!Number.isSafeInteger(key) || key < 0))) throw new Error(`非法 JSON 路径：${id}`)
    }

    enabled(state: ProjectState): boolean { return isManagedItem(state, this.managedItemId) }
    locate(_state: ProjectState): JsonPath { return this.path }
    make(state: ProjectState): JsonExpected { return this.value(state) ?? undefined }

    check(state: ProjectState, json: JsonValue): CheckResult<JsonExpected, JsonPath> {
        let expected: JsonExpected
        try { expected = this.make(state) } catch (error) { return {kind: "Fatal", cause: "config-invalid", message: errorMessage(error)} }
        const location = this.locate(state)
        let actual: JsonExpected
        try { actual = readJsonPath(json, location) } catch (error) { return {kind: "Resolvable", cause: "damaged", message: errorMessage(error), expected} }
        if (actual === undefined && expected !== undefined) return {kind: "Resolvable", cause: "missing", message: `缺少 JSON 字段 ${JSON.stringify(location)}`, expected}
        return isDeepStrictEqual(actual, expected) ? {kind: "Idle", actual, expected, location} : {kind: "Applicable", cause: "outdated", actual, expected, location}
    }
}
