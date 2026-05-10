export const BRIDGE_MAGIC = 0x0D000721
export const BRIDGE_VERSION = 1

export type NodeId = number
export type EventSlotId = string
export type NativeCommitTarget = {
    protocolVersion?: number
    bridgeVersion?: number
    commit?: (ops: Array<BridgeOp | NativeCommitCommand>) => void
    commitCommandBuffer?: (bytes: Uint8Array) => void
}

export type BridgeEncodedRecord = {[key: string]: BridgeEncodedValue}
export type BridgeEncodedValue = undefined | null | number | boolean | string | BridgeEncodedRecord | BridgeEncodedValue[]

export type BridgeSerializablePrimitive = undefined | null | number | boolean | string
export type BridgeModifierSerializableValue =
    | BridgeSerializablePrimitive
    | {[key: string]: BridgeModifierSerializableValue}
    | BridgeModifierSerializableValue[]
export type BridgeEventSlotCallback = (...args: unknown[]) => unknown
export type BridgeEventSlotBinding = {
    eventSlot: EventSlotId
    callback: BridgeEventSlotCallback
}
export type BridgeEncodedEventSlotBinding = {
    eventSlot: EventSlotId
}
export type BridgeModifierValue =
    | BridgeModifierSerializableValue
    | BridgeEventSlotBinding
    | {[key: string]: BridgeModifierValue}
    | BridgeModifierValue[]
export type BridgeModifierElement = {type: string} & Record<string, BridgeModifierValue>
export type BridgeModifierPayload = BridgeModifierElement[]
export type BridgeEncodedModifierElement = {type: string} & Record<string, BridgeModifierSerializableValue | BridgeEncodedEventSlotBinding>
export type BridgeEncodedModifierPayload = BridgeEncodedModifierElement[]

export const BridgeOpcode = Object.freeze({
    createNode: 1,
    deleteNode: 2,
    insertChild: 3,
    removeChild: 4,
    setProp: 5,
    setModifier: 6,
    setText: 7,
} as const)

export type BridgeOpName = keyof typeof BridgeOpcode

export type BridgeOp =
    | {op: "createNode"; id: NodeId; nodeType: string}
    | {op: "deleteNode"; id: NodeId}
    | {op: "insertChild"; parent: NodeId; child: NodeId; index: number}
    | {op: "removeChild"; parent: NodeId; child: NodeId}
    | {op: "setProp"; id: NodeId; key: string; value: BridgeEncodedValue | BridgeEventSlotBinding}
    | {op: "setModifier"; id: NodeId; modifier: BridgeModifierPayload}
    | {op: "setText"; id: NodeId; text: string}

export type NativeCommitCommand = {op: "unmount"}

export type BridgeBatch = {
    header?: {
        magic: number
        version: number
        flags: number
        opCount: number
    }
    ops: BridgeOp[]
}

const opcodeName: Record<number, BridgeOpName> = Object.fromEntries(
    Object.entries(BridgeOpcode).map(([key, value]) => [value, key]),
) as Record<number, BridgeOpName>

export function encodeBridgeBatch(ops: readonly BridgeOp[]): Uint8Array {
    const strings: string[] = []
    const stringIndex = new Map<string, number>()
    const words: number[] = []
    const intern = (value: unknown): number => {
        const text = String(value ?? "")
        const existing = stringIndex.get(text)
        if (existing != null) return existing
        const index = strings.length
        stringIndex.set(text, index)
        strings.push(text)
        return index
    }

    for (const op of ops) {
        const code = BridgeOpcode[op.op]
        words.push(code)
        switch (op.op) {
            case "createNode":
                words.push(op.id, intern(op.nodeType))
                break
            case "deleteNode":
                words.push(op.id)
                break
            case "insertChild":
                words.push(op.parent, op.child, op.index)
                break
            case "removeChild":
                words.push(op.parent, op.child)
                break
            case "setProp":
                words.push(op.id, intern(op.key), intern(encodeValue(op.value)))
                break
            case "setModifier":
                words.push(op.id, intern(encodeValue(toBridgeEncodedValue(op.modifier))))
                break
            case "setText":
                words.push(op.id, intern(op.text))
                break
        }
    }

    const encoder = new TextEncoder()
    const encodedStrings = strings.map((value) => encoder.encode(value))
    const wordCount = 4 + 1 + encodedStrings.reduce((count, value) => count + 1 + Math.ceil(value.length / 4), 0) + 1 + words.length
    const buffer = new ArrayBuffer(wordCount * 4)
    const view = new DataView(buffer)
    let offset = 0
    const u32 = (value: number): void => {
        view.setUint32(offset, value >>> 0, true)
        offset += 4
    }

    u32(BRIDGE_MAGIC)
    u32(BRIDGE_VERSION)
    u32(0)
    u32(ops.length)
    u32(encodedStrings.length)
    for (const bytes of encodedStrings) {
        u32(bytes.length)
        new Uint8Array(buffer, offset, bytes.length).set(bytes)
        offset += Math.ceil(bytes.length / 4) * 4
    }
    u32(words.length)
    for (const word of words) u32(word)
    return new Uint8Array(buffer, 0, offset)
}

export function decodeBridgeBatch(bytes: Uint8Array): Required<Pick<BridgeBatch, "header" | "ops">> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    const u32 = (): number => {
        const value = view.getUint32(offset, true)
        offset += 4
        return value
    }

    const magic = u32()
    const version = u32()
    const flags = u32()
    const opCount = u32()
    if (magic !== BRIDGE_MAGIC) throw new Error(`Invalid Arrange bridge magic: 0x${magic.toString(16)}`)
    if (version !== BRIDGE_VERSION) throw new Error(`Unsupported Arrange bridge version: ${version}`)

    const decoder = new TextDecoder()
    const stringCount = u32()
    const strings: string[] = []
    for (let i = 0; i < stringCount; i += 1) {
        const length = u32()
        strings.push(decoder.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length)))
        offset += Math.ceil(length / 4) * 4
    }

    const wordCount = u32()
    const words: number[] = []
    for (let i = 0; i < wordCount; i += 1) words.push(u32())

    let index = 0
    const ops: BridgeOp[] = []
    const str = (stringIndex: number): string => strings[stringIndex] ?? ""
    for (let i = 0; i < opCount; i += 1) {
        const code = words[index++]
        const op = opcodeName[code]
        switch (op) {
            case "createNode":
                ops.push({op, id: words[index++], nodeType: str(words[index++])})
                break
            case "deleteNode":
                ops.push({op, id: words[index++]})
                break
            case "insertChild":
                ops.push({op, parent: words[index++], child: words[index++], index: words[index++]})
                break
            case "removeChild":
                ops.push({op, parent: words[index++], child: words[index++]})
                break
            case "setProp":
                ops.push({op, id: words[index++], key: str(words[index++]), value: decodeValue(str(words[index++]))})
                break
            case "setModifier":
                ops.push({op, id: words[index++], modifier: decodeValue(str(words[index++])) as BridgeModifierPayload})
                break
            case "setText":
                ops.push({op, id: words[index++], text: str(words[index++])})
                break
            default:
                throw new Error(`Unknown Arrange bridge opcode: ${code}`)
        }
    }
    return {header: {magic, version, flags, opCount}, ops}
}

function toBridgeEncodedValue(value: BridgeModifierPayload): BridgeEncodedValue {
    return encodeModifierPayload(value) as BridgeEncodedValue
}

export function encodeModifierPayload(payload: BridgeModifierPayload): BridgeEncodedModifierPayload {
    return payload.map((element) => encodeModifierElement(element))
}

function encodeModifierElement(element: BridgeModifierElement): BridgeEncodedModifierElement {
    const encoded: BridgeEncodedModifierElement = {type: element.type}
    for (const [key, value] of Object.entries(element)) {
        if (key === "type") continue
        encoded[key] = encodeModifierValue(value) as BridgeModifierSerializableValue | BridgeEncodedEventSlotBinding
    }
    return encoded
}

function encodeModifierValue(value: BridgeModifierValue): BridgeModifierSerializableValue | BridgeEncodedEventSlotBinding {
    if (isBridgeEventSlotBinding(value)) return {eventSlot: value.eventSlot}
    if (Array.isArray(value)) return value.map((child) => encodeModifierValue(child)) as BridgeModifierSerializableValue[]
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, encodeModifierValue(child as BridgeModifierValue)]),
        ) as BridgeModifierSerializableValue
    }
    return value
}

function isBridgeEventSlotBinding(value: unknown): value is BridgeEventSlotBinding {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof (value as {eventSlot?: unknown}).eventSlot === "string" &&
        typeof (value as {callback?: unknown}).callback === "function",
    )
}

function encodeValue(value: BridgeEncodedValue | BridgeEventSlotBinding): string {
    if (isBridgeEventSlotBinding(value)) return "s:[Function]"
    if (value === undefined) return "u:"
    if (value === null) return "n:"
    if (typeof value === "function") return "s:[Function]"
    if (typeof value === "number") return `f:${value}`
    if (typeof value === "boolean") return `b:${value ? 1 : 0}`
    if (typeof value === "string") return `s:${value}`
    return `o:${JSON.stringify(value, (_key, val: unknown) => typeof val === "function" ? "[Function]" : val)}`
}

function decodeValue(value: string): BridgeEncodedValue {
    const kind = value.slice(0, 2)
    const body = value.slice(2)
    if (kind === "u:") return undefined
    if (kind === "n:") return null
    if (kind === "f:") return Number(body)
    if (kind === "b:") return body === "1"
    if (kind === "s:") return body
    if (kind === "o:") return JSON.parse(body) as BridgeEncodedValue
    throw new Error(`Unknown encoded bridge value kind: ${kind}`)
}
