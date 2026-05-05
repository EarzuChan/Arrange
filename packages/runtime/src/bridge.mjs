export const BRIDGE_MAGIC = 0x0D000721;
export const BRIDGE_VERSION = 1;
export const BridgeOpcode = Object.freeze({ createNode: 1, deleteNode: 2, insertChild: 3, removeChild: 4, setProp: 5, setModifier: 6, setText: 7 });
const opcodeName = Object.fromEntries(Object.entries(BridgeOpcode).map(([k, v]) => [v, k]));

export function encodeBridgeBatch(ops) {
  const strings = []; const stringIndex = new Map(); const words = [];
  const intern = (value) => { const text = String(value ?? ""); if (!stringIndex.has(text)) { stringIndex.set(text, strings.length); strings.push(text); } return stringIndex.get(text); };
  for (const op of ops) {
    const code = BridgeOpcode[op.op]; if (!code) throw new Error(`Unknown bridge op ${op.op}`); words.push(code);
    switch (op.op) {
      case "createNode": words.push(op.id, intern(op.nodeType)); break;
      case "deleteNode": words.push(op.id); break;
      case "insertChild": words.push(op.parent, op.child, op.index); break;
      case "removeChild": words.push(op.parent, op.child); break;
      case "setProp": words.push(op.id, intern(op.key), intern(encodeValue(op.value))); break;
      case "setModifier": words.push(op.id, intern(encodeValue(op.modifier))); break;
      case "setText": words.push(op.id, intern(op.text)); break;
    }
  }
  const encoder = new TextEncoder(); const encodedStrings = strings.map((s) => encoder.encode(s));
  const wordCount = 4 + 1 + encodedStrings.reduce((n, s) => n + 1 + Math.ceil(s.length / 4), 0) + 1 + words.length;
  const buffer = new ArrayBuffer(wordCount * 4); const view = new DataView(buffer); let offset = 0;
  const u32 = (value) => { view.setUint32(offset, value >>> 0, true); offset += 4; };
  u32(BRIDGE_MAGIC); u32(BRIDGE_VERSION); u32(0); u32(ops.length); u32(encodedStrings.length);
  for (const bytes of encodedStrings) { u32(bytes.length); new Uint8Array(buffer, offset, bytes.length).set(bytes); offset += Math.ceil(bytes.length / 4) * 4; }
  u32(words.length); for (const word of words) u32(word);
  return new Uint8Array(buffer, 0, offset);
}

export function decodeBridgeBatch(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0;
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const magic = u32(); const version = u32(); const flags = u32(); const opCount = u32();
  if (magic !== BRIDGE_MAGIC) throw new Error(`Invalid Arrange bridge magic: 0x${magic.toString(16)}`);
  if (version !== BRIDGE_VERSION) throw new Error(`Unsupported Arrange bridge version: ${version}`);
  const decoder = new TextDecoder(); const stringCount = u32(); const strings = [];
  for (let i = 0; i < stringCount; i++) { const length = u32(); strings.push(decoder.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length))); offset += Math.ceil(length / 4) * 4; }
  const wordCount = u32(); const words = []; for (let i = 0; i < wordCount; i++) words.push(u32());
  let index = 0; const ops = []; const str = (i) => strings[i];
  for (let i = 0; i < opCount; i++) {
    const code = words[index++]; const op = opcodeName[code];
    switch (op) {
      case "createNode": ops.push({ op, id: words[index++], nodeType: str(words[index++]) }); break;
      case "deleteNode": ops.push({ op, id: words[index++] }); break;
      case "insertChild": ops.push({ op, parent: words[index++], child: words[index++], index: words[index++] }); break;
      case "removeChild": ops.push({ op, parent: words[index++], child: words[index++] }); break;
      case "setProp": ops.push({ op, id: words[index++], key: str(words[index++]), value: decodeValue(str(words[index++])) }); break;
      case "setModifier": ops.push({ op, id: words[index++], modifier: decodeValue(str(words[index++])) }); break;
      case "setText": ops.push({ op, id: words[index++], text: str(words[index++]) }); break;
      default: throw new Error(`Unknown Arrange bridge opcode: ${code}`);
    }
  }
  return { header: { magic, version, flags, opCount }, ops };
}
function encodeValue(value) { if (value === undefined) return "u:"; if (value === null) return "n:"; if (typeof value === "number") return `f:${value}`; if (typeof value === "boolean") return `b:${value ? 1 : 0}`; if (typeof value === "string") return `s:${value}`; return `o:${JSON.stringify(value, (_key, val) => typeof val === "function" ? "[Function]" : val)}`; }
function decodeValue(value) { const kind = value.slice(0, 2); const body = value.slice(2); if (kind === "u:") return undefined; if (kind === "n:") return null; if (kind === "f:") return Number(body); if (kind === "b:") return body === "1"; if (kind === "s:") return body; if (kind === "o:") return JSON.parse(body); throw new Error(`Unknown encoded bridge value kind: ${kind}`); }
