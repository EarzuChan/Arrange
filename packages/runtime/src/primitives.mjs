export function dp(value) { return numberUnit(value, "dp"); }
export function sp(value) { return numberUnit(value, "sp"); }
export function px(value) { return numberUnit(value, "px"); }

function numberUnit(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name}(...) expects a finite number`);
  return value;
}

export function Color(value) {
  if (typeof value === "number") return value >>> 0;
  if (value && typeof value === "object") {
    const red = channel(value.red, "red");
    const green = channel(value.green, "green");
    const blue = channel(value.blue, "blue");
    const alpha = channel(value.alpha ?? 1, "alpha");
    return (((alpha * 255) & 0xff) << 24 | ((red * 255) & 0xff) << 16 | ((green * 255) & 0xff) << 8 | ((blue * 255) & 0xff)) >>> 0;
  }
  throw new TypeError("Color expects 0xAARRGGBB or { red, green, blue, alpha }.");
}
function channel(value, name) {
  if (typeof value !== "number" || value < 0 || value > 1) throw new RangeError(`Color channel ${name} must be in 0..1`);
  return Math.round(value * 255) / 255;
}
export function colorToHex(color) { return `0x${(color >>> 0).toString(16).toUpperCase().padStart(8, "0")}`; }

export const RectangleShape = Object.freeze({ type: "rectangle" });
export const CircleShape = Object.freeze({ type: "circle" });
export function rounded(value) { return typeof value === "number" ? Object.freeze({ type: "rounded", radius: value }) : Object.freeze({ type: "rounded", radii: { ...value } }); }
export function solidColor(color) { return Object.freeze({ type: "solidColor", color }); }
export function linearGradient(args) { return Object.freeze({ type: "linearGradient", ...args }); }
export function radialGradient(args) { return Object.freeze({ type: "radialGradient", ...args }); }

export const Alignment = Object.freeze({
  TopStart: "TopStart", TopCenter: "TopCenter", TopEnd: "TopEnd",
  CenterStart: "CenterStart", Center: "Center", CenterEnd: "CenterEnd",
  BottomStart: "BottomStart", BottomCenter: "BottomCenter", BottomEnd: "BottomEnd",
  Start: "Start", CenterHorizontally: "CenterHorizontally", End: "End",
  Top: "Top", CenterVertically: "CenterVertically", Bottom: "Bottom",
});
function spacedBy(space, alignment) { return Object.freeze({ kind: "spacedBy", space, alignment }); }
export const Arrangement = Object.freeze({
  Start: "Start", Top: "Top", Center: "Center", End: "End", Bottom: "Bottom",
  SpaceBetween: "SpaceBetween", SpaceAround: "SpaceAround", SpaceEvenly: "SpaceEvenly", spacedBy,
});
export function PaddingValues(value) {
  if (typeof value === "number") return Object.freeze({ start: value, top: value, end: value, bottom: value });
  const horizontal = value.horizontal ?? 0; const vertical = value.vertical ?? 0;
  return Object.freeze({ start: value.start ?? horizontal, top: value.top ?? vertical, end: value.end ?? horizontal, bottom: value.bottom ?? vertical });
}
export const IntrinsicSize = Object.freeze({ Min: "IntrinsicSize.Min", Max: "IntrinsicSize.Max" });
export const ContentScale = Object.freeze({ Fit: "Fit", Crop: "Crop", FillBounds: "FillBounds", Inside: "Inside", None: "None", FillWidth: "FillWidth", FillHeight: "FillHeight" });
export const Role = Object.freeze({ Button: "Button", Checkbox: "Checkbox", Slider: "Slider", TextField: "TextField", Image: "Image" });
export const Orientation = Object.freeze({ Horizontal: "Horizontal", Vertical: "Vertical" });
export const GridCells = Object.freeze({ Fixed(count) { return Object.freeze({ type: "Fixed", count }); }, Adaptive(minSize) { return Object.freeze({ type: "Adaptive", minSize }); } });
export function GridItemSpan(count) { return Object.freeze({ type: "GridItemSpan", count }); }
GridItemSpan.MaxLineSpan = Object.freeze({ type: "GridItemSpan.MaxLineSpan" });
