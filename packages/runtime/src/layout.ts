import {Box, Row, Column, Spacer, Text, Input, Image, Icon, Canvas} from "./components.ts"
import {colorToHex, Alignment} from "./primitives.ts"
import type {Modifier, ModifierElement} from "./modifier.ts"
import type {FocusRequester, InteractionState} from "./state.ts"
import type {ArrangeElementVNode, ArrangeVNode} from "./types.ts"

const INF = Number.POSITIVE_INFINITY

type LooseObject = Record<string, unknown>

export type LayoutVNode = ArrangeElementVNode

type Constraints = {
    minWidth: number
    maxWidth: number
    minHeight: number
    maxHeight: number
}

type RenderOptions = {
    constraints?: Partial<Constraints>
    width?: number
    height?: number
}

type Rect = {x: number; y: number; width: number; height: number}

type TextLayout = {text: string; maxLines: number; overflow: string; textAlign: string}

type TextDrawOptions = {textAlign: string; overflow: string; maxLines: number}
type ImageDrawOptions = {contentScale: unknown; alignment: unknown; tint: unknown}

export type DrawOp =
    | ["fillRect", number, number, number, number, unknown]
    | ["fillEllipse", number, number, number, number, unknown]
    | ["fillRoundRect", number, number, number, number, number, unknown]
    | ["strokeRect", number, number, number, number, number, unknown]
    | ["strokeEllipse", number, number, number, number, number, unknown]
    | ["strokeRoundRect", number, number, number, number, number, number, unknown]
    | ["pushClip", number, number, number, number]
    | ["pushClipEllipse", number, number, number, number]
    | ["pushClipRoundRect", number, number, number, number, number]
    | ["popClip"]
    | ["pushTransform", number, number, number, number, number, number, number, number, number]
    | ["popTransform"]
    | ["drawLine", number, number, number, number, number, unknown]
    | ["drawText", string, number, number, number, number]
    | ["drawText", string, number, number, number, number, TextDrawOptions]
    | ["drawImage", unknown, number, number, number, number, ImageDrawOptions]

export type MeasuredNode = {
    type: string
    constraints: Constraints
    width: number
    height: number
    x: number
    y: number
    children: MeasuredNode[]
    vnode?: LayoutVNode
    modifier?: Modifier
    tags?: string[]
    clickable?: LooseObject
    hoverable?: LooseObject
    focusable?: boolean
    focusRequester?: FocusRequester
    onFocusChanged?: (event: {focused: boolean}) => void
    interactionState?: InteractionState
    baseline?: number
    textLayout?: TextLayout
    wrapper?: "padding" | "verticalScroll" | "horizontalScroll"
    p?: {start: number; top: number; end: number; bottom: number}
    scroll?: number
    spacing?: number
}

export function renderVNode(vnode: ArrangeVNode, options: RenderOptions = {}): MeasuredNode {
    const constraints = norm(options.constraints ?? {minWidth: 0, maxWidth: options.width ?? 800, minHeight: 0, maxHeight: options.height ?? 600})
    const measured = measureNode(vnode, constraints)
    placeNode(measured, 0, 0)
    return measured
}

function norm(c: Partial<Constraints>): Constraints {
    return {minWidth: c.minWidth ?? 0, maxWidth: c.maxWidth ?? INF, minHeight: c.minHeight ?? 0, maxHeight: c.maxHeight ?? INF}
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
}

function finite(v: number, f = 0): number {
    return Number.isFinite(v) ? v : f
}

function asVNode(vnode: ArrangeVNode): LayoutVNode {
    if (typeof vnode === "string" || typeof vnode === "number") return {$$arrangeVNode: true, type: Text, props: {text: String(vnode)}, children: []}
    return {...vnode, props: vnode.props ?? {}, children: vnode.children ?? []}
}

function elementsOf(vnode: LayoutVNode): readonly ModifierElement[] {
    return vnode.props?.modifier?.elements ?? []
}

function measureNode(vnodeInput: ArrangeVNode, constraints: Constraints): MeasuredNode {
    const vnode = asVNode(vnodeInput)
    const elements = elementsOf(vnode)
    const measured = measureWithModifier(vnode, elements, 0, constraints)
    measured.vnode = vnode
    measured.modifier = vnode.props?.modifier
    measured.tags = elements.filter((e) => e.type === "testTag").map((e) => String(e.value.name))
    measured.clickable = [...elements].reverse().find((e) => e.type === "clickable")?.value
    measured.hoverable = [...elements].reverse().find((e) => e.type === "hoverable")?.value
    const focusable = [...elements].reverse().find((e) => e.type === "focusable")?.value
    const clickableFocusable = measured.clickable ? measured.clickable.focusable !== false && measured.clickable.enabled !== false : false
    measured.focusable = focusable ? focusable.enabled !== false : clickableFocusable
    measured.focusRequester = [...elements].reverse().find((e) => e.type === "focusRequester")?.value.requester as MeasuredNode["focusRequester"]
    measured.onFocusChanged = [...elements].reverse().find((e) => e.type === "onFocusChanged")?.value.callback as MeasuredNode["onFocusChanged"]
    measured.interactionState = (focusable?.interactionState ?? measured.clickable?.interactionState ?? measured.hoverable?.interactionState) as MeasuredNode["interactionState"]
    return measured
}

function measureWithModifier(vnode: LayoutVNode, elements: readonly ModifierElement[], index: number, constraints: Constraints): MeasuredNode {
    if (index >= elements.length) return measureContent(vnode, constraints)
    const e = elements[index]
    const value = e.value
    switch (e.type) {
        case "padding": {
            const p = padding(value)
            const child = measureWithModifier(vnode, elements, index + 1, shrink(constraints, p.start + p.end, p.top + p.bottom))
            return node(vnode.type, constraints, clamp(child.width + p.start + p.end, constraints.minWidth, constraints.maxWidth), clamp(child.height + p.top + p.bottom, constraints.minHeight, constraints.maxHeight), [child], {wrapper: "padding", p})
        }
        case "width": return exact(vnode, elements, index, constraints, num(value.value), undefined)
        case "height": return exact(vnode, elements, index, constraints, undefined, num(value.value))
        case "size": return exact(vnode, elements, index, constraints, num(value.width), num(value.height))
        case "requiredWidth": return exact(vnode, elements, index, constraints, num(value.width), undefined, true)
        case "requiredHeight": return exact(vnode, elements, index, constraints, undefined, num(value.height), true)
        case "requiredSize": return exact(vnode, elements, index, constraints, num(value.width), num(value.height), true)
        case "widthIn": return constrained(vnode, elements, index, constraints, {minWidth: num(value.min), maxWidth: num(value.max)})
        case "heightIn": return constrained(vnode, elements, index, constraints, {minHeight: num(value.min), maxHeight: num(value.max)})
        case "sizeIn": return constrained(vnode, elements, index, constraints, value)
        case "defaultMinSize": return constrained(vnode, elements, index, constraints, {minWidth: Math.max(constraints.minWidth, num(value.minWidth) ?? 0), minHeight: Math.max(constraints.minHeight, num(value.minHeight) ?? 0)}, true)
        case "fillMaxWidth":
            if (Number.isFinite(constraints.maxWidth)) return exact(vnode, elements, index, constraints, constraints.maxWidth * (num(value.fraction) ?? 1), undefined)
            break
        case "fillMaxHeight":
            if (Number.isFinite(constraints.maxHeight)) return exact(vnode, elements, index, constraints, undefined, constraints.maxHeight * (num(value.fraction) ?? 1))
            break
        case "fillMaxSize":
            return exact(vnode, elements, index, constraints, Number.isFinite(constraints.maxWidth) ? constraints.maxWidth * (num(value.fraction) ?? 1) : undefined, Number.isFinite(constraints.maxHeight) ? constraints.maxHeight * (num(value.fraction) ?? 1) : undefined)
        case "verticalScroll": {
            const child = measureWithModifier(vnode, elements, index + 1, {...constraints, maxHeight: INF})
            return node(vnode.type, constraints, clamp(child.width, constraints.minWidth, constraints.maxWidth), clamp(child.height, constraints.minHeight, constraints.maxHeight), [child], {wrapper: "verticalScroll", scroll: num(obj(value.state).value) ?? 0})
        }
        case "horizontalScroll": {
            const child = measureWithModifier(vnode, elements, index + 1, {...constraints, maxWidth: INF})
            return node(vnode.type, constraints, clamp(child.width, constraints.minWidth, constraints.maxWidth), clamp(child.height, constraints.minHeight, constraints.maxHeight), [child], {wrapper: "horizontalScroll", scroll: num(obj(value.state).value) ?? 0})
        }
    }
    return measureWithModifier(vnode, elements, index + 1, constraints)
}

function num(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined }
function obj(value: unknown): LooseObject { return value && typeof value === "object" ? value as LooseObject : {} }
function padding(value: LooseObject): {start: number; top: number; end: number; bottom: number} { return {start: num(value.start) ?? 0, top: num(value.top) ?? 0, end: num(value.end) ?? 0, bottom: num(value.bottom) ?? 0} }

function shrink(c: Constraints, dx: number, dy: number): Constraints {
    return {minWidth: Math.max(0, c.minWidth - dx), maxWidth: Math.max(0, c.maxWidth - dx), minHeight: Math.max(0, c.minHeight - dy), maxHeight: Math.max(0, c.maxHeight - dy)}
}

function exact(vnode: LayoutVNode, elements: readonly ModifierElement[], index: number, c: Constraints, width?: number, height?: number, required = false): MeasuredNode {
    const next = {...c}
    if (typeof width === "number") {
        const w = required ? width : clamp(width, c.minWidth, c.maxWidth)
        next.minWidth = next.maxWidth = w
    }
    if (typeof height === "number") {
        const h = required ? height : clamp(height, c.minHeight, c.maxHeight)
        next.minHeight = next.maxHeight = h
    }
    return measureWithModifier(vnode, elements, index + 1, next)
}

function constrained(vnode: LayoutVNode, elements: readonly ModifierElement[], index: number, c: Constraints, patch: LooseObject, absolute = false): MeasuredNode {
    const next = {...c}
    const minWidth = num(patch.minWidth), maxWidth = num(patch.maxWidth), minHeight = num(patch.minHeight), maxHeight = num(patch.maxHeight)
    if (minWidth !== undefined) next.minWidth = absolute ? minWidth : Math.max(next.minWidth, minWidth)
    if (maxWidth !== undefined) next.maxWidth = Math.min(next.maxWidth, maxWidth)
    if (minHeight !== undefined) next.minHeight = absolute ? minHeight : Math.max(next.minHeight, minHeight)
    if (maxHeight !== undefined) next.maxHeight = Math.min(next.maxHeight, maxHeight)
    return measureWithModifier(vnode, elements, index + 1, next)
}

function measureContent(vnode: LayoutVNode, c: Constraints): MeasuredNode {
    switch (vnode.type) {
        case Box: return measureBox(vnode, c)
        case Row: return measureRow(vnode, c)
        case Column: return measureColumn(vnode, c)
        case Spacer: return node(Spacer, c, c.minWidth, c.minHeight, [])
        case Text: return measureText(vnode, c)
        case Input: return measureInput(vnode, c)
        case Image:
        case Icon:
        case Canvas: {
            const s = vnode.type === Icon ? (num(vnode.props?.size) ?? 24) : 0
            return node(vnode.type, c, clamp(s, c.minWidth, c.maxWidth), clamp(s, c.minHeight, c.maxHeight), [])
        }
        default: throw new Error(`Unknown Arrange native node: ${String(vnode.type)}`)
    }
}

function measureBox(vnode: LayoutVNode, c: Constraints): MeasuredNode {
    const cc = vnode.props?.propagateMinConstraints ? c : {...c, minWidth: 0, minHeight: 0}
    const children = vnode.children.map((child) => measureNode(child, cc))
    const normal = children.filter((ch) => !mod(ch, "matchParentSize"))
    const w = clamp(Math.max(0, ...normal.map((ch) => ch.width)), c.minWidth, c.maxWidth)
    const h = clamp(Math.max(0, ...normal.map((ch) => ch.height)), c.minHeight, c.maxHeight)
    for (const ch of children.filter((x) => mod(x, "matchParentSize"))) { ch.width = w; ch.height = h }
    return node(Box, c, w, h, children)
}

function measureRow(vnode: LayoutVNode, c: Constraints): MeasuredNode {
    const spacing = spacingOf(vnode.props?.horizontalArrangement)
    const pairs = vnode.children.map((child) => ({child, weight: childWeight(child)}))
    const fixed = pairs.filter((p) => !p.weight).map((p) => measureNode(p.child, {minWidth: 0, maxWidth: INF, minHeight: c.minHeight, maxHeight: c.maxHeight}))
    const remaining = Math.max(0, finite(c.maxWidth, 0) - fixed.reduce((n, x) => n + x.width, 0) - Math.max(0, pairs.length - 1) * spacing)
    const sum = pairs.reduce((n, p) => n + (num(p.weight?.value.weight) ?? 0), 0)
    let fi = 0
    const children = pairs.map((p) => {
        if (!p.weight) return fixed[fi++]
        const weight = num(p.weight.value.weight) ?? 0
        const fill = p.weight.value.fill !== false
        const a = sum > 0 ? remaining * weight / sum : 0
        return measureNode(p.child, {minWidth: fill ? a : 0, maxWidth: a, minHeight: c.minHeight, maxHeight: c.maxHeight})
    })
    return node(Row, c, clamp(children.reduce((n, x) => n + x.width, 0) + Math.max(0, children.length - 1) * spacing, c.minWidth, c.maxWidth), clamp(Math.max(0, ...children.map((x) => x.height)), c.minHeight, c.maxHeight), children, {spacing})
}

function measureColumn(vnode: LayoutVNode, c: Constraints): MeasuredNode {
    const spacing = spacingOf(vnode.props?.verticalArrangement)
    const pairs = vnode.children.map((child) => ({child, weight: childWeight(child)}))
    const fixed = pairs.filter((p) => !p.weight).map((p) => measureNode(p.child, {minWidth: 0, maxWidth: c.maxWidth, minHeight: 0, maxHeight: INF}))
    const remaining = Math.max(0, finite(c.maxHeight, 0) - fixed.reduce((n, x) => n + x.height, 0) - Math.max(0, pairs.length - 1) * spacing)
    const sum = pairs.reduce((n, p) => n + (num(p.weight?.value.weight) ?? 0), 0)
    let fi = 0
    const children = pairs.map((p) => {
        if (!p.weight) return fixed[fi++]
        const weight = num(p.weight.value.weight) ?? 0
        const fill = p.weight.value.fill !== false
        const a = sum > 0 ? remaining * weight / sum : 0
        return measureNode(p.child, {minWidth: 0, maxWidth: c.maxWidth, minHeight: fill ? a : 0, maxHeight: a})
    })
    return node(Column, c, clamp(Math.max(0, ...children.map((x) => x.width)), c.minWidth, c.maxWidth), clamp(children.reduce((n, x) => n + x.height, 0) + Math.max(0, children.length - 1) * spacing, c.minHeight, c.maxHeight), children, {spacing})
}

function childWeight(child: ArrangeVNode): ModifierElement | undefined {
    return typeof child === "object" ? child.props?.modifier?.elements?.find((e: ModifierElement) => e.type === "weight") : undefined
}

function measureText(vnode: LayoutVNode, c: Constraints, minWidth = 0, minHeight = 0): MeasuredNode {
    const text = String(vnode.props?.text ?? "")
    const style = obj(vnode.props?.textStyle ?? vnode.props?.["text-style"])
    const fs = num(style.fontSize) ?? 14
    const lineHeight = Math.max(fs, num(style.lineHeight) ?? fs * 1.2)
    const maxLines = Math.max(0, num(vnode.props?.maxLines) ?? 0)
    const lines = text.split("\n")
    const visible = maxLines > 0 ? lines.slice(0, maxLines) : lines
    const w = Math.max(minWidth, ...visible.map((line) => line.length * fs * 0.6))
    const h = Math.max(minHeight, lineHeight * Math.max(1, visible.length))
    const n = node(Text, c, clamp(w, c.minWidth, c.maxWidth), clamp(h, c.minHeight, c.maxHeight), [])
    n.baseline = lineHeight * 0.8
    n.textLayout = {text, maxLines, overflow: String(vnode.props?.overflow ?? "clip"), textAlign: String(vnode.props?.textAlign ?? "start")}
    return n
}

function measureInput(vnode: LayoutVNode, c: Constraints): MeasuredNode {
    const props = vnode.props ?? {}
    const text = String(props.modelValue ?? props["model-value"] ?? props.value ?? props.placeholder ?? "")
    const style = obj(props.textStyle ?? props["text-style"])
    const fs = num(style.fontSize) ?? 14
    const lineHeight = Math.max(fs, num(style.lineHeight) ?? fs * 1.2)
    const singleLine = props.singleLine ?? props["single-line"] ?? true
    const minLines = singleLine ? 1 : Math.max(1, num(props.minLines) ?? num(props["min-lines"]) ?? 1)
    const maxLines = singleLine ? 1 : Math.max(0, num(props.maxLines) ?? num(props["max-lines"]) ?? 0)
    const drawMaxLines = maxLines > 0 ? maxLines : String(text).split("\n").length
    const measured = measureText({...vnode, props: {...props, text, maxLines: drawMaxLines}}, c, 120, Math.max(28, lineHeight * minLines))
    if (measured.textLayout) measured.textLayout.text = String(text)
    return measured
}

function node(type: string, constraints: Constraints, width: number, height: number, children: MeasuredNode[], extra: Partial<MeasuredNode> = {}): MeasuredNode {
    return {type, constraints, width, height, x: 0, y: 0, children, ...extra}
}

function spacingOf(a: unknown): number { const value = obj(a); return value.kind === "spacedBy" ? num(value.space) ?? 0 : 0 }
function mod(measured: MeasuredNode, type: string): ModifierElement | undefined { return measured.modifier?.elements?.find((e) => e.type === type) }
function align(measured: MeasuredNode): string | undefined { return mod(measured, "align")?.value.alignment as string | undefined }

function placeNode(n: MeasuredNode, x: number, y: number): void {
    const off = offset(n); x += off.x; y += off.y; n.x = x; n.y = y
    if (n.wrapper === "padding" && n.p) { placeNode(n.children[0], x + n.p.start, y + n.p.top); return }
    if (n.wrapper === "verticalScroll") { placeNode(n.children[0], x, y - (n.scroll ?? 0)); return }
    if (n.wrapper === "horizontalScroll") { placeNode(n.children[0], x - (n.scroll ?? 0), y); return }
    if (n.type === Row) { let cx = x; for (const ch of n.children) { placeNode(ch, cx, y + cross(n.height, ch.height, align(ch))); cx += ch.width + (n.spacing ?? 0) } return }
    if (n.type === Column) { let cy = y; for (const ch of n.children) { placeNode(ch, x + cross(n.width, ch.width, align(ch)), cy); cy += ch.height + (n.spacing ?? 0) } return }
    if (n.type === Box) { for (const ch of sort(n.children)) { const a = align(ch) ?? String(n.vnode?.props?.contentAlignment ?? Alignment.TopStart); placeNode(ch, x + ax(n.width, ch.width, a), y + ay(n.height, ch.height, a)) } return }
    for (const ch of n.children ?? []) placeNode(ch, x, y)
}

function cross(p: number, c: number, a?: string): number { if (a === Alignment.Center || a === Alignment.CenterVertically || a === Alignment.CenterHorizontally) return (p - c) / 2; if (a === Alignment.End || a === Alignment.Bottom || a === Alignment.CenterEnd || a === Alignment.BottomEnd) return p - c; return 0 }
function ax(p: number, c: number, a?: string): number { return a?.includes?.("Center") ? (p - c) / 2 : a?.includes?.("End") ? p - c : 0 }
function ay(p: number, c: number, a?: string): number { return a?.startsWith?.("Center") ? (p - c) / 2 : a?.startsWith?.("Bottom") ? p - c : 0 }
function sort(children: readonly MeasuredNode[]): MeasuredNode[] { return [...children].sort((a, b) => (num(mod(a, "zIndex")?.value.value) ?? 0) - (num(mod(b, "zIndex")?.value.value) ?? 0)) }
function offset(measured: MeasuredNode): {x: number; y: number} { return (measured.modifier?.elements ?? []).reduce((acc, e) => e.type === "offset" || e.type === "absoluteOffset" ? {x: acc.x + (num(e.value.x) ?? 0), y: acc.y + (num(e.value.y) ?? 0)} : e.type === "graphicsLayer" ? {x: acc.x + (num(e.value.translationX) ?? 0), y: acc.y + (num(e.value.translationY) ?? 0)} : acc, {x: 0, y: 0}) }

export function collectDrawOps(n: MeasuredNode, ops: DrawOp[] = [], inheritedAlpha = 1): DrawOp[] {
    const elements = n.modifier?.elements ?? n.vnode?.props?.modifier?.elements ?? []
    let rect: Rect = {x: n.x, y: n.y, width: n.width, height: n.height}
    const popStack: DrawOp[] = []
    let alpha = inheritedAlpha
    for (const e of elements) {
        if (e.type === "dropShadow") pushFill(ops, shadowRect(rect, e.value), brush(e.value.color ?? 0x55000000, alpha), e.value.shape)
        if (e.type === "innerShadow") pushStroke(ops, rect, num(e.value.width) ?? 1, brush(e.value.color ?? 0x55000000, alpha), e.value.shape)
        if (e.type === "alpha") alpha *= Math.max(0, Math.min(1, num(e.value.value) ?? 1))
        if (e.type === "background") pushFill(ops, rect, brush(e.value.brush, alpha), e.value.shape)
        if (e.type === "border") pushStroke(ops, rect, num(e.value.width) ?? 0, brush(e.value.brush, alpha), e.value.shape)
        if (e.type === "padding") rect = shrinkRect(rect, padding(e.value))
        if (e.type === "clip" || e.type === "verticalScroll" || e.type === "horizontalScroll") { pushClip(ops, rect, e.value.shape); popStack.push(["popClip"]) }
        if (needsTransform(e)) { const origin = transformOrigin(e.value.transformOrigin); ops.push(["pushTransform", rect.x, rect.y, rect.width, rect.height, num(e.value.scaleX) ?? 1, num(e.value.scaleY) ?? 1, num(e.value.rotationZ) ?? 0, origin.x, origin.y]); popStack.push(["popTransform"]) }
    }
    if (n.type === Text) {
        const text = n.textLayout?.text ?? String(n.vnode?.props?.text ?? "")
        const meta = n.textLayout ?? {maxLines: 0, overflow: "clip", textAlign: "start"}
        const hasTextOptions = meta.maxLines > 0 || meta.overflow !== "clip" || meta.textAlign !== "start"
        if (hasTextOptions) ops.push(["drawText", text, rect.x, rect.y, rect.width, rect.height, {textAlign: meta.textAlign, overflow: meta.overflow, maxLines: meta.maxLines}])
        else ops.push(["drawText", text, rect.x, rect.y, rect.width, rect.height])
    }
    if (n.type === Image) ops.push(["drawImage", n.vnode?.props?.source ?? "", rect.x, rect.y, rect.width, rect.height, {contentScale: n.vnode?.props?.contentScale ?? "Fit", alignment: n.vnode?.props?.alignment ?? Alignment.Center, tint: n.vnode?.props?.tint}])
    for (const ch of sort(n.children ?? [])) collectDrawOps(ch, ops, alpha)
    while (popStack.length > 0) ops.push(popStack.pop() as DrawOp)
    return ops
}

function shrinkRect(rect: Rect, p: {start: number; top: number; end: number; bottom: number}): Rect { return {x: rect.x + p.start, y: rect.y + p.top, width: Math.max(0, rect.width - p.start - p.end), height: Math.max(0, rect.height - p.top - p.bottom)} }
function shadowRect(rect: Rect, value: LooseObject): Rect { const offset = obj(value.offset); return {x: rect.x + (num(value.offsetX) ?? num(value.x) ?? num(offset.x) ?? 0), y: rect.y + (num(value.offsetY) ?? num(value.y) ?? num(offset.y) ?? 0), width: rect.width, height: rect.height} }
function shapeKind(shape: unknown): string { return String(obj(shape).type ?? "rectangle") }
function roundedRadius(shape: unknown): number { const s = obj(shape); const radii = obj(s.radii); return num(s.radius) ?? num(radii.topStart) ?? num(radii.topEnd) ?? num(radii.bottomEnd) ?? num(radii.bottomStart) ?? 0 }
function pushFill(ops: DrawOp[], rect: Rect, color: unknown, shape: unknown): void { if (shapeKind(shape) === "circle") { ops.push(["fillEllipse", rect.x, rect.y, rect.width, rect.height, color]); return } if (shapeKind(shape) === "rounded") { ops.push(["fillRoundRect", rect.x, rect.y, rect.width, rect.height, roundedRadius(shape), color]); return } ops.push(["fillRect", rect.x, rect.y, rect.width, rect.height, color]) }
function pushStroke(ops: DrawOp[], rect: Rect, width: number, color: unknown, shape: unknown): void { if (shapeKind(shape) === "circle") { ops.push(["strokeEllipse", rect.x, rect.y, rect.width, rect.height, width, color]); return } if (shapeKind(shape) === "rounded") { ops.push(["strokeRoundRect", rect.x, rect.y, rect.width, rect.height, roundedRadius(shape), width, color]); return } ops.push(["strokeRect", rect.x, rect.y, rect.width, rect.height, width, color]) }
function pushClip(ops: DrawOp[], rect: Rect, shape: unknown): void { if (shapeKind(shape) === "circle") { ops.push(["pushClipEllipse", rect.x, rect.y, rect.width, rect.height]); return } if (shapeKind(shape) === "rounded") { ops.push(["pushClipRoundRect", rect.x, rect.y, rect.width, rect.height, roundedRadius(shape)]); return } ops.push(["pushClip", rect.x, rect.y, rect.width, rect.height]) }
function needsTransform(e: ModifierElement): boolean { return e.type === "graphicsLayer" && (Math.abs((num(e.value.scaleX) ?? 1) - 1) > 0.0001 || Math.abs((num(e.value.scaleY) ?? 1) - 1) > 0.0001 || Math.abs(num(e.value.rotationZ) ?? 0) > 0.0001) }
function transformOrigin(value: unknown): {x: number; y: number} { if (value && typeof value === "object") { const o = obj(value); return {x: num(o.x) ?? 0.5, y: num(o.y) ?? 0.5} } switch (value) { case Alignment.TopStart: return {x: 0, y: 0}; case Alignment.TopCenter: return {x: 0.5, y: 0}; case Alignment.TopEnd: return {x: 1, y: 0}; case Alignment.CenterStart: return {x: 0, y: 0.5}; case Alignment.CenterEnd: return {x: 1, y: 0.5}; case Alignment.BottomStart: return {x: 0, y: 1}; case Alignment.BottomCenter: return {x: 0.5, y: 1}; case Alignment.BottomEnd: return {x: 1, y: 1}; default: return {x: 0.5, y: 0.5} } }
function brush(v: unknown, alpha = 1): unknown { return typeof v === "number" ? colorToHex(applyAlpha(v, alpha)) : obj(v).type ?? String(v) }
function applyAlpha(color: number, alpha: number): number { const source = color >>> 0; const a = Math.round(((source >>> 24) & 0xff) * Math.max(0, Math.min(1, alpha))); return ((a << 24) | (source & 0x00ffffff)) >>> 0 }
