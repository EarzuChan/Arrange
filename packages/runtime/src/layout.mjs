import { Box, Row, Column, Spacer, Text, Input, Image, Icon, Canvas } from "./components.mjs";
import { colorToHex, Alignment } from "./primitives.mjs";
const INF = Number.POSITIVE_INFINITY;

export function renderVNode(vnode, options = {}) {
  const constraints = norm(options.constraints ?? { minWidth: 0, maxWidth: options.width ?? 800, minHeight: 0, maxHeight: options.height ?? 600 });
  const measured = measureNode(vnode, constraints);
  placeNode(measured, 0, 0);
  return measured;
}
function norm(c) { return { minWidth: c.minWidth ?? 0, maxWidth: c.maxWidth ?? INF, minHeight: c.minHeight ?? 0, maxHeight: c.maxHeight ?? INF }; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function finite(v, f = 0) { return Number.isFinite(v) ? v : f; }

function measureNode(vnode, constraints) {
  if (typeof vnode === "string" || typeof vnode === "number") vnode = { type: Text, props: { text: String(vnode) }, children: [] };
  const elements = vnode.props?.modifier?.elements ?? [];
  const measured = measureWithModifier(vnode, elements, 0, constraints);
  measured.vnode = vnode; measured.modifier = vnode.props?.modifier;
  measured.tags = elements.filter((e) => e.type === "testTag").map((e) => e.value.name);
  measured.clickable = [...elements].reverse().find((e) => e.type === "clickable")?.value;
  measured.hoverable = [...elements].reverse().find((e) => e.type === "hoverable")?.value;
  const focusable = [...elements].reverse().find((e) => e.type === "focusable")?.value;
  const clickableFocusable = measured.clickable ? measured.clickable.focusable !== false && measured.clickable.enabled !== false : false;
  measured.focusable = focusable ? focusable.enabled !== false : clickableFocusable;
  measured.focusRequester = [...elements].reverse().find((e) => e.type === "focusRequester")?.value.requester;
  measured.onFocusChanged = [...elements].reverse().find((e) => e.type === "onFocusChanged")?.value.callback;
  measured.interactionState = focusable?.interactionState ?? measured.clickable?.interactionState ?? measured.hoverable?.interactionState;
  return measured;
}

function measureWithModifier(vnode, elements, index, constraints) {
  if (index >= elements.length) return measureContent(vnode, constraints);
  const e = elements[index];
  switch (e.type) {
    case "padding": {
      const p = e.value; const child = measureWithModifier(vnode, elements, index + 1, shrink(constraints, p.start + p.end, p.top + p.bottom));
      return node(vnode.type, constraints, clamp(child.width + p.start + p.end, constraints.minWidth, constraints.maxWidth), clamp(child.height + p.top + p.bottom, constraints.minHeight, constraints.maxHeight), [child], { wrapper: "padding", p });
    }
    case "width": return exact(vnode, elements, index, constraints, e.value.value, undefined);
    case "height": return exact(vnode, elements, index, constraints, undefined, e.value.value);
    case "size": return exact(vnode, elements, index, constraints, e.value.width, e.value.height);
    case "requiredWidth": return exact(vnode, elements, index, constraints, e.value.width, undefined, true);
    case "requiredHeight": return exact(vnode, elements, index, constraints, undefined, e.value.height, true);
    case "requiredSize": return exact(vnode, elements, index, constraints, e.value.width, e.value.height, true);
    case "widthIn": return constrained(vnode, elements, index, constraints, { minWidth: e.value.min, maxWidth: e.value.max });
    case "heightIn": return constrained(vnode, elements, index, constraints, { minHeight: e.value.min, maxHeight: e.value.max });
    case "sizeIn": return constrained(vnode, elements, index, constraints, e.value);
    case "defaultMinSize": return constrained(vnode, elements, index, constraints, { minWidth: Math.max(constraints.minWidth, e.value.minWidth ?? 0), minHeight: Math.max(constraints.minHeight, e.value.minHeight ?? 0) }, true);
    case "fillMaxWidth": if (Number.isFinite(constraints.maxWidth)) return exact(vnode, elements, index, constraints, constraints.maxWidth * e.value.fraction, undefined); break;
    case "fillMaxHeight": if (Number.isFinite(constraints.maxHeight)) return exact(vnode, elements, index, constraints, undefined, constraints.maxHeight * e.value.fraction); break;
    case "fillMaxSize": return exact(vnode, elements, index, constraints, Number.isFinite(constraints.maxWidth) ? constraints.maxWidth * e.value.fraction : undefined, Number.isFinite(constraints.maxHeight) ? constraints.maxHeight * e.value.fraction : undefined);
    case "verticalScroll": {
      const child = measureWithModifier(vnode, elements, index + 1, { ...constraints, maxHeight: INF });
      return node(vnode.type, constraints, clamp(child.width, constraints.minWidth, constraints.maxWidth), clamp(child.height, constraints.minHeight, constraints.maxHeight), [child], { wrapper: "verticalScroll", scroll: e.value.state?.value ?? 0 });
    }
    case "horizontalScroll": {
      const child = measureWithModifier(vnode, elements, index + 1, { ...constraints, maxWidth: INF });
      return node(vnode.type, constraints, clamp(child.width, constraints.minWidth, constraints.maxWidth), clamp(child.height, constraints.minHeight, constraints.maxHeight), [child], { wrapper: "horizontalScroll", scroll: e.value.state?.value ?? 0 });
    }
  }
  return measureWithModifier(vnode, elements, index + 1, constraints);
}
function shrink(c, dx, dy) { return { minWidth: Math.max(0, c.minWidth - dx), maxWidth: Math.max(0, c.maxWidth - dx), minHeight: Math.max(0, c.minHeight - dy), maxHeight: Math.max(0, c.maxHeight - dy) }; }
function exact(vnode, elements, index, c, width, height, required = false) { const next = { ...c }; if (typeof width === "number") { const w = required ? width : clamp(width, c.minWidth, c.maxWidth); next.minWidth = next.maxWidth = w; } if (typeof height === "number") { const h = required ? height : clamp(height, c.minHeight, c.maxHeight); next.minHeight = next.maxHeight = h; } return measureWithModifier(vnode, elements, index + 1, next); }
function constrained(vnode, elements, index, c, patch, absolute = false) { const next = { ...c }; if (patch.minWidth !== undefined) next.minWidth = absolute ? patch.minWidth : Math.max(next.minWidth, patch.minWidth); if (patch.maxWidth !== undefined) next.maxWidth = Math.min(next.maxWidth, patch.maxWidth); if (patch.minHeight !== undefined) next.minHeight = absolute ? patch.minHeight : Math.max(next.minHeight, patch.minHeight); if (patch.maxHeight !== undefined) next.maxHeight = Math.min(next.maxHeight, patch.maxHeight); return measureWithModifier(vnode, elements, index + 1, next); }

function measureContent(vnode, c) {
  switch (vnode.type) {
    case Box: return measureBox(vnode, c);
    case Row: return measureRow(vnode, c);
    case Column: return measureColumn(vnode, c);
    case Spacer: return node(Spacer, c, c.minWidth, c.minHeight, []);
    case Text: return measureText(vnode, c);
    case Input: return measureInput(vnode, c);
    case Image: case Icon: case Canvas: { const s = vnode.type === Icon ? (vnode.props?.size ?? 24) : 0; return node(vnode.type, c, clamp(s, c.minWidth, c.maxWidth), clamp(s, c.minHeight, c.maxHeight), []); }
    default: throw new Error(`Unknown Arrange native node: ${String(vnode.type)}`);
  }
}
function measureBox(vnode, c) { const cc = vnode.props?.propagateMinConstraints ? c : { ...c, minWidth: 0, minHeight: 0 }; const children = vnode.children.map((child) => measureNode(child, cc)); const normal = children.filter((ch) => !mod(ch, "matchParentSize")); const w = clamp(Math.max(0, ...normal.map((ch) => ch.width)), c.minWidth, c.maxWidth); const h = clamp(Math.max(0, ...normal.map((ch) => ch.height)), c.minHeight, c.maxHeight); for (const ch of children.filter((x) => mod(x, "matchParentSize"))) { ch.width = w; ch.height = h; } return node(Box, c, w, h, children); }
function measureRow(vnode, c) { const spacing = spacingOf(vnode.props?.horizontalArrangement); const pairs = vnode.children.map((child) => ({ child, weight: child.props?.modifier?.elements?.find((e) => e.type === "weight") })); const fixed = pairs.filter((p) => !p.weight).map((p) => measureNode(p.child, { minWidth: 0, maxWidth: INF, minHeight: c.minHeight, maxHeight: c.maxHeight })); const remaining = Math.max(0, finite(c.maxWidth, 0) - fixed.reduce((n, x) => n + x.width, 0) - Math.max(0, pairs.length - 1) * spacing); const sum = pairs.reduce((n, p) => n + (p.weight?.value.weight ?? 0), 0); let fi = 0; const children = pairs.map((p) => { if (!p.weight) return fixed[fi++]; const a = sum > 0 ? remaining * p.weight.value.weight / sum : 0; return measureNode(p.child, { minWidth: p.weight.value.fill ? a : 0, maxWidth: a, minHeight: c.minHeight, maxHeight: c.maxHeight }); }); return node(Row, c, clamp(children.reduce((n, x) => n + x.width, 0) + Math.max(0, children.length - 1) * spacing, c.minWidth, c.maxWidth), clamp(Math.max(0, ...children.map((x) => x.height)), c.minHeight, c.maxHeight), children, { spacing }); }
function measureColumn(vnode, c) { const spacing = spacingOf(vnode.props?.verticalArrangement); const pairs = vnode.children.map((child) => ({ child, weight: child.props?.modifier?.elements?.find((e) => e.type === "weight") })); const fixed = pairs.filter((p) => !p.weight).map((p) => measureNode(p.child, { minWidth: 0, maxWidth: c.maxWidth, minHeight: 0, maxHeight: INF })); const remaining = Math.max(0, finite(c.maxHeight, 0) - fixed.reduce((n, x) => n + x.height, 0) - Math.max(0, pairs.length - 1) * spacing); const sum = pairs.reduce((n, p) => n + (p.weight?.value.weight ?? 0), 0); let fi = 0; const children = pairs.map((p) => { if (!p.weight) return fixed[fi++]; const a = sum > 0 ? remaining * p.weight.value.weight / sum : 0; return measureNode(p.child, { minWidth: 0, maxWidth: c.maxWidth, minHeight: p.weight.value.fill ? a : 0, maxHeight: a }); }); return node(Column, c, clamp(Math.max(0, ...children.map((x) => x.width)), c.minWidth, c.maxWidth), clamp(children.reduce((n, x) => n + x.height, 0) + Math.max(0, children.length - 1) * spacing, c.minHeight, c.maxHeight), children, { spacing }); }
function measureText(vnode, c, minWidth = 0, minHeight = 0) {
  const text = String(vnode.props?.text ?? "");
  const style = vnode.props?.textStyle ?? vnode.props?.["text-style"] ?? {};
  const fs = style.fontSize ?? 14;
  const lineHeight = Math.max(fs, style.lineHeight ?? fs * 1.2);
  const maxLines = Math.max(0, vnode.props?.maxLines ?? 0);
  const lines = text.split("\n");
  const visible = maxLines > 0 ? lines.slice(0, maxLines) : lines;
  const w = Math.max(minWidth, ...visible.map((line) => line.length * fs * 0.6));
  const h = Math.max(minHeight, lineHeight * Math.max(1, visible.length));
  const n = node(Text, c, clamp(w, c.minWidth, c.maxWidth), clamp(h, c.minHeight, c.maxHeight), []);
  n.baseline = lineHeight * 0.8;
  n.textLayout = { text, maxLines, overflow: vnode.props?.overflow ?? "clip", textAlign: vnode.props?.textAlign ?? "start" };
  return n;
}
function measureInput(vnode, c) {
  const props = vnode.props ?? {};
  const text = props.modelValue ?? props["model-value"] ?? props.value ?? props.placeholder ?? "";
  const style = props.textStyle ?? props["text-style"] ?? {};
  const fs = style.fontSize ?? 14;
  const lineHeight = Math.max(fs, style.lineHeight ?? fs * 1.2);
  const singleLine = props.singleLine ?? props["single-line"] ?? true;
  const minLines = singleLine ? 1 : Math.max(1, props.minLines ?? props["min-lines"] ?? 1);
  const maxLines = singleLine ? 1 : Math.max(0, props.maxLines ?? props["max-lines"] ?? 0);
  const drawMaxLines = maxLines > 0 ? maxLines : String(text).split("\n").length;
  const measured = measureText({ ...vnode, props: { ...props, text, maxLines: drawMaxLines } }, c, 120, Math.max(28, lineHeight * minLines));
  measured.textLayout.text = String(text);
  return measured;
}
function node(type, constraints, width, height, children, extra = {}) { return { type, constraints, width, height, x: 0, y: 0, children, ...extra }; }
function spacingOf(a) { return typeof a === "object" && a.kind === "spacedBy" ? a.space : 0; }
function mod(measured, type) { return measured.modifier?.elements?.find((e) => e.type === type); }
function align(measured) { return mod(measured, "align")?.value.alignment; }

function placeNode(n, x, y) { const off = offset(n); x += off.x; y += off.y; n.x = x; n.y = y; if (n.wrapper === "padding") { placeNode(n.children[0], x + n.p.start, y + n.p.top); return; } if (n.wrapper === "verticalScroll") { placeNode(n.children[0], x, y - n.scroll); return; } if (n.wrapper === "horizontalScroll") { placeNode(n.children[0], x - n.scroll, y); return; } if (n.type === Row) { let cx = x; for (const ch of n.children) { placeNode(ch, cx, y + cross(n.height, ch.height, align(ch))); cx += ch.width + (n.spacing ?? 0); } return; } if (n.type === Column) { let cy = y; for (const ch of n.children) { placeNode(ch, x + cross(n.width, ch.width, align(ch)), cy); cy += ch.height + (n.spacing ?? 0); } return; } if (n.type === Box) { for (const ch of sort(n.children)) { const a = align(ch) ?? n.vnode?.props?.contentAlignment ?? Alignment.TopStart; placeNode(ch, x + ax(n.width, ch.width, a), y + ay(n.height, ch.height, a)); } return; } for (const ch of n.children ?? []) placeNode(ch, x, y); }
function cross(p, c, a) { if (a === Alignment.Center || a === Alignment.CenterVertically || a === Alignment.CenterHorizontally) return (p - c) / 2; if (a === Alignment.End || a === Alignment.Bottom || a === Alignment.CenterEnd || a === Alignment.BottomEnd) return p - c; return 0; }
function ax(p, c, a) { return a?.includes?.("Center") ? (p - c) / 2 : a?.includes?.("End") ? p - c : 0; }
function ay(p, c, a) { return a?.startsWith?.("Center") ? (p - c) / 2 : a?.startsWith?.("Bottom") ? p - c : 0; }
function sort(children) { return [...children].sort((a, b) => (mod(a, "zIndex")?.value.value ?? 0) - (mod(b, "zIndex")?.value.value ?? 0)); }
function offset(measured) { return (measured.modifier?.elements ?? []).reduce((acc, e) => e.type === "offset" || e.type === "absoluteOffset" ? { x: acc.x + (e.value.x ?? 0), y: acc.y + (e.value.y ?? 0) } : e.type === "graphicsLayer" ? { x: acc.x + (e.value.translationX ?? 0), y: acc.y + (e.value.translationY ?? 0) } : acc, { x: 0, y: 0 }); }

export function collectDrawOps(n, ops = [], inheritedAlpha = 1) {
  const elements = n.modifier?.elements ?? n.vnode?.props?.modifier?.elements ?? [];
  let rect = { x: n.x, y: n.y, width: n.width, height: n.height };
  const popStack = [];
  let alpha = inheritedAlpha;
  for (const e of elements) {
    if (e.type === "dropShadow") pushFill(ops, shadowRect(rect, e.value), brush(e.value.color ?? 0x55000000, alpha), e.value.shape);
    if (e.type === "innerShadow") pushStroke(ops, rect, e.value.width ?? 1, brush(e.value.color ?? 0x55000000, alpha), e.value.shape);
    if (e.type === "alpha") alpha *= Math.max(0, Math.min(1, e.value.value ?? 1));
    if (e.type === "background") pushFill(ops, rect, brush(e.value.brush, alpha), e.value.shape);
    if (e.type === "border") pushStroke(ops, rect, e.value.width, brush(e.value.brush, alpha), e.value.shape);
    if (e.type === "padding") rect = shrinkRect(rect, e.value);
    if (e.type === "clip" || e.type === "verticalScroll" || e.type === "horizontalScroll") { pushClip(ops, rect, e.value.shape); popStack.push(["popClip"]); }
    if (needsTransform(e)) {
      const origin = transformOrigin(e.value.transformOrigin);
      ops.push(["pushTransform", rect.x, rect.y, rect.width, rect.height, e.value.scaleX ?? 1, e.value.scaleY ?? 1, e.value.rotationZ ?? 0, origin.x, origin.y]);
      popStack.push(["popTransform"]);
    }
  }
  if (n.type === Text) {
    const text = n.textLayout?.text ?? n.vnode?.props?.text ?? "";
    const meta = n.textLayout ?? {};
    const hasTextOptions = meta.maxLines > 0 || meta.overflow !== "clip" || meta.textAlign !== "start";
    if (hasTextOptions) {
      ops.push(["drawText", text, rect.x, rect.y, rect.width, rect.height, { textAlign: meta.textAlign, overflow: meta.overflow, maxLines: meta.maxLines }]);
    } else {
      ops.push(["drawText", text, rect.x, rect.y, rect.width, rect.height]);
    }
  }
  if (n.type === Image) {
    ops.push(["drawImage", n.vnode?.props?.source ?? "", rect.x, rect.y, rect.width, rect.height, {
      contentScale: n.vnode?.props?.contentScale ?? "Fit",
      alignment: n.vnode?.props?.alignment ?? Alignment.Center,
      tint: n.vnode?.props?.tint,
    }]);
  }
  for (const ch of sort(n.children ?? [])) collectDrawOps(ch, ops, alpha);
  while (popStack.length > 0) ops.push(popStack.pop());
  return ops;
}
function shrinkRect(rect, p) { return { x: rect.x + p.start, y: rect.y + p.top, width: Math.max(0, rect.width - p.start - p.end), height: Math.max(0, rect.height - p.top - p.bottom) }; }
function shadowRect(rect, value) { return { x: rect.x + (value.offsetX ?? value.x ?? value.offset?.x ?? 0), y: rect.y + (value.offsetY ?? value.y ?? value.offset?.y ?? 0), width: rect.width, height: rect.height }; }
function shapeKind(shape) { return shape?.type ?? "rectangle"; }
function roundedRadius(shape) { return shape?.radius ?? shape?.radii?.topStart ?? shape?.radii?.topEnd ?? shape?.radii?.bottomEnd ?? shape?.radii?.bottomStart ?? 0; }
function pushFill(ops, rect, color, shape) {
  if (shapeKind(shape) === "circle") { ops.push(["fillEllipse", rect.x, rect.y, rect.width, rect.height, color]); return; }
  if (shapeKind(shape) === "rounded") { ops.push(["fillRoundRect", rect.x, rect.y, rect.width, rect.height, roundedRadius(shape), color]); return; }
  ops.push(["fillRect", rect.x, rect.y, rect.width, rect.height, color]);
}
function pushStroke(ops, rect, width, color, shape) {
  if (shapeKind(shape) === "circle") { ops.push(["strokeEllipse", rect.x, rect.y, rect.width, rect.height, width, color]); return; }
  if (shapeKind(shape) === "rounded") { ops.push(["strokeRoundRect", rect.x, rect.y, rect.width, rect.height, roundedRadius(shape), width, color]); return; }
  ops.push(["strokeRect", rect.x, rect.y, rect.width, rect.height, width, color]);
}
function pushClip(ops, rect, shape) {
  if (shapeKind(shape) === "circle") { ops.push(["pushClipEllipse", rect.x, rect.y, rect.width, rect.height]); return; }
  if (shapeKind(shape) === "rounded") { ops.push(["pushClipRoundRect", rect.x, rect.y, rect.width, rect.height, roundedRadius(shape)]); return; }
  ops.push(["pushClip", rect.x, rect.y, rect.width, rect.height]);
}
function needsTransform(e) {
  if (e.type !== "graphicsLayer") return false;
  return Math.abs((e.value.scaleX ?? 1) - 1) > 0.0001 || Math.abs((e.value.scaleY ?? 1) - 1) > 0.0001 || Math.abs(e.value.rotationZ ?? 0) > 0.0001;
}
function transformOrigin(value) {
  if (value && typeof value === "object") return { x: value.x ?? 0.5, y: value.y ?? 0.5 };
  switch (value) {
    case Alignment.TopStart: return { x: 0, y: 0 };
    case Alignment.TopCenter: return { x: 0.5, y: 0 };
    case Alignment.TopEnd: return { x: 1, y: 0 };
    case Alignment.CenterStart: return { x: 0, y: 0.5 };
    case Alignment.CenterEnd: return { x: 1, y: 0.5 };
    case Alignment.BottomStart: return { x: 0, y: 1 };
    case Alignment.BottomCenter: return { x: 0.5, y: 1 };
    case Alignment.BottomEnd: return { x: 1, y: 1 };
    default: return { x: 0.5, y: 0.5 };
  }
}
function brush(v, alpha = 1) { return typeof v === "number" ? colorToHex(applyAlpha(v, alpha)) : v?.type ?? String(v); }
function applyAlpha(color, alpha) { const source = color >>> 0; const a = Math.round(((source >>> 24) & 0xff) * Math.max(0, Math.min(1, alpha))); return ((a << 24) | (source & 0x00ffffff)) >>> 0; }

