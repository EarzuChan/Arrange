import { PaddingValues } from "./primitives.mjs";

export class Modifier {
  constructor(elements = []) { this.elements = Object.freeze([...elements]); Object.freeze(this); }
  then(other) { return new Modifier([...this.elements, ...toModifier(other).elements]); }
  if(condition, ifModifier, elseModifier = m) { return condition ? this.then(ifModifier) : this.then(elseModifier); }
  width(value) { return this.#add("width", { value }); }
  height(value) { return this.#add("height", { value }); }
  size(width, height = width) { return this.#add("size", { width, height }); }
  requiredWidth(width) { return this.#add("requiredWidth", { width }); }
  requiredHeight(height) { return this.#add("requiredHeight", { height }); }
  requiredSize(width, height = width) { return this.#add("requiredSize", { width, height }); }
  widthIn(args) { return this.#add("widthIn", { ...args }); }
  heightIn(args) { return this.#add("heightIn", { ...args }); }
  sizeIn(args) { return this.#add("sizeIn", { ...args }); }
  defaultMinSize(args) { return this.#add("defaultMinSize", { ...args }); }
  fillMaxWidth(fraction = 1) { return this.#add("fillMaxWidth", checkedFraction(fraction)); }
  fillMaxHeight(fraction = 1) { return this.#add("fillMaxHeight", checkedFraction(fraction)); }
  fillMaxSize(fraction = 1) { return this.#add("fillMaxSize", checkedFraction(fraction)); }
  wrapContentWidth(align, unbounded = false) { return this.#add("wrapContentWidth", { align, unbounded }); }
  wrapContentHeight(align, unbounded = false) { return this.#add("wrapContentHeight", { align, unbounded }); }
  wrapContentSize(align, unbounded = false) { return this.#add("wrapContentSize", { align, unbounded }); }
  aspectRatio(ratio, matchHeightConstraintsFirst = false) { return this.#add("aspectRatio", { ratio, matchHeightConstraintsFirst }); }
  padding(value) { return this.#add("padding", PaddingValues(value)); }
  offset(args) { return this.#add("offset", { x: args.x ?? 0, y: args.y ?? 0 }); }
  absoluteOffset(args) { return this.#add("absoluteOffset", { x: args.x ?? 0, y: args.y ?? 0 }); }
  align(alignment) { return this.#add("align", { alignment }); }
  weight(weight, args = {}) { if (!(weight > 0)) throw new RangeError("m.weight(...) requires weight > 0"); return this.#add("weight", { weight, fill: args.fill ?? true }); }
  matchParentSize() { return this.#add("matchParentSize", {}); }
  zIndex(value) { return this.#add("zIndex", { value }); }
  background(brush, shape) { return this.#add("background", { brush, shape }); }
  border(widthOrArgs, brush, shape) { return typeof widthOrArgs === "object" ? this.#add("border", { align: "inside", ...widthOrArgs }) : this.#add("border", { width: widthOrArgs, brush, shape, align: "inside" }); }
  clip(shape) { return this.#add("clip", { shape }); }
  dropShadow(args) { return this.#add("dropShadow", { ...args }); }
  innerShadow(args) { return this.#add("innerShadow", { ...args }); }
  alpha(value) { return this.#add("alpha", { value }); }
  graphicsLayer(args = {}) { return this.#add("graphicsLayer", { ...args }); }
  drawBehind(draw) { return this.#add("drawBehind", { draw }); }
  drawWithContent(draw) { return this.#add("drawWithContent", { draw }); }
  drawWithCache(build) { return this.#add("drawWithCache", { build }); }
  clickable(arg) { return this.#add("clickable", typeof arg === "function" ? { onClick: arg, enabled: true, focusable: true } : { enabled: true, focusable: true, ...arg }); }
  hoverable(args = {}) { return this.#add("hoverable", { enabled: true, ...args }); }
  focusable(arg = true) { return this.#add("focusable", typeof arg === "boolean" ? { enabled: arg } : { enabled: true, ...arg }); }
  focusRequester(requester) { return this.#add("focusRequester", { requester }); }
  onFocusChanged(callback) { return this.#add("onFocusChanged", { callback }); }
  focusProperties(args) { return this.#add("focusProperties", { ...args }); }
  focusGroup() { return this.#add("focusGroup", {}); }
  pointerInput(handler) { return this.#add("pointerInput", { handler }); }
  verticalScroll(state, args = {}) { return this.#add("verticalScroll", { state, enabled: true, ...args }); }
  horizontalScroll(state, args = {}) { return this.#add("horizontalScroll", { state, enabled: true, ...args }); }
  scrollable(state, orientation, args = {}) { return this.#add("scrollable", { state, orientation, enabled: true, ...args }); }
  animateContentSize() { return this.#add("animateContentSize", {}); }
  testTag(name) { return this.#add("testTag", { name }); }
  toJSON() { return this.elements.map((element) => ({ type: element.type, ...serializable(element.value) })); }
  #add(type, value) { return new Modifier([...this.elements, Object.freeze({ type, value: Object.freeze(value) })]); }
}
function serializable(value) { return JSON.parse(JSON.stringify(value, (_key, val) => typeof val === "function" ? "[Function]" : val)); }
function checkedFraction(fraction) { if (typeof fraction !== "number" || fraction < 0 || fraction > 1) throw new RangeError("fillMax* fraction must be in 0..1"); return { fraction }; }
export function toModifier(value) { if (value == null) return m; if (value instanceof Modifier) return value; throw new TypeError("Expected Arrange Modifier"); }
export const m = new Modifier();
