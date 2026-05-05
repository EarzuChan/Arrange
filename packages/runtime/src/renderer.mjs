import { evaluateRoot } from "./components.mjs";

export function renderToBridgeOps(root) {
  return renderToBridgeBatch(root).ops;
}

export function renderToBridgeBatch(root) {
  const vnode = evaluateRoot(typeof root === "function" ? root : () => root);
  const writer = new BridgeOpWriter();
  writer.mount(vnode);
  return { ops: writer.ops, callbacks: writer.callbacks };
}

export class BridgeOpWriter {
  constructor() {
    this.nextId = 1;
    this.nextCallbackHandle = 1;
    this.ops = [];
    this.callbacks = [];
  }

  mount(vnode) { return this.#emitNode(vnode, null, 0); }

  #emitNode(vnode, parentId, index) {
    if (typeof vnode === "string" || typeof vnode === "number") {
      const id = this.nextId++;
      this.ops.push({ op: "createNode", id, nodeType: "Text" });
      this.ops.push({ op: "setText", id, text: String(vnode) });
      if (parentId != null) this.ops.push({ op: "insertChild", parent: parentId, child: id, index });
      return id;
    }

    const id = this.nextId++;
    this.ops.push({ op: "createNode", id, nodeType: vnode.type });
    for (const [key, value] of Object.entries(vnode.props ?? {})) {
      if (key === "modifier") continue;
      if (key === "text" && vnode.type === "Text") this.ops.push({ op: "setText", id, text: String(value) });
      else this.ops.push({ op: "setProp", id, key, value: serializeProp(value) });
    }
    const modifier = vnode.props?.modifier;
    if (modifier?.elements?.length) {
      const serializedModifier = this.#serializeModifier(modifier);
      this.ops.push({ op: "setModifier", id, modifier: serializedModifier });
      for (const prop of this.#nativeModifierProps(modifier, false, serializedModifier)) {
        this.ops.push({ op: "setProp", id, ...prop });
      }
    }
    if (parentId != null) this.ops.push({ op: "insertChild", parent: parentId, child: id, index });
    vnode.children?.forEach((child, childIndex) => this.#emitNode(child, id, childIndex));
    return id;
  }

  #serializeModifier(modifier) {
    return modifier.elements.map((element) => ({ type: element.type, ...this.#serializeValue(element.value) }));
  }

  #serializeValue(value) {
    if (typeof value === "function") return { callbackHandle: this.#registerCallback(value) };
    if (Array.isArray(value)) return value.map((child) => this.#serializeValue(child));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.#serializeValue(child)]));
    }
    return value;
  }

  #registerCallback(callback) {
    const handle = this.nextCallbackHandle++;
    this.callbacks.push({ handle, callback });
    return handle;
  }

  #nativeModifierProps(modifier, includeDisabled = false, serializedModifier = null) {
    const scroll = { vertical: null, horizontal: null };
    let clickable = null;
    let weight = null;
    let align = null;
    let zIndex = null;
    let layoutOffsetX = 0;
    let layoutOffsetY = 0;
    let hasLayoutOffset = false;
    let hasLayer = false;
    let layerScaleX = 1;
    let layerScaleY = 1;
    let layerRotationZ = 0;
    let layerOriginX = 0.5;
    let layerOriginY = 0.5;
    const elements = modifier?.elements ?? [];
    for (let index = 0; index < elements.length; ++index) {
      const element = elements[index];
      const serializedElement = serializedModifier?.[index] ?? null;
      if (element.type === "verticalScroll") {
        scroll.vertical = { value: element.value ?? {}, serialized: serializedElement };
      }
      if (element.type === "horizontalScroll") {
        scroll.horizontal = { value: element.value ?? {}, serialized: serializedElement };
      }
      if (element.type === "clickable") clickable = { value: element.value ?? {}, serialized: serializedElement };
      if (element.type === "weight") weight = element.value ?? {};
      if (element.type === "align" && align == null) align = element.value?.alignment ?? "";
      if (element.type === "zIndex") zIndex = element.value?.value ?? 0;
      if (element.type === "offset" || element.type === "absoluteOffset") {
        layoutOffsetX += typeof element.value?.x === "number" ? element.value.x : 0;
        layoutOffsetY += typeof element.value?.y === "number" ? element.value.y : 0;
        hasLayoutOffset = true;
      }
      if (element.type === "graphicsLayer") {
        layoutOffsetX += typeof element.value?.translationX === "number" ? element.value.translationX : 0;
        layoutOffsetY += typeof element.value?.translationY === "number" ? element.value.translationY : 0;
        hasLayoutOffset = true;
        hasLayer = true;
        layerScaleX = typeof element.value?.scaleX === "number" ? element.value.scaleX : 1;
        layerScaleY = typeof element.value?.scaleY === "number" ? element.value.scaleY : 1;
        layerRotationZ = typeof element.value?.rotationZ === "number" ? element.value.rotationZ : 0;
        const origin = transformOriginPair(element.value?.transformOrigin);
        layerOriginX = origin.x;
        layerOriginY = origin.y;
      }
    }
    return [
      ...this.#clickProps(clickable, includeDisabled),
      ...this.#scrollProps("Vertical", scroll.vertical, includeDisabled),
      ...this.#scrollProps("Horizontal", scroll.horizontal, includeDisabled),
      ...this.#weightProps(weight, includeDisabled),
      ...this.#alignProps(align, includeDisabled),
      ...this.#zIndexProps(zIndex, includeDisabled),
      ...this.#layoutOffsetProps(hasLayoutOffset, layoutOffsetX, layoutOffsetY, includeDisabled),
      ...this.#layerTransformProps(hasLayer, layerScaleX, layerScaleY, layerRotationZ, layerOriginX, layerOriginY, includeDisabled),
      ...this.#modifierElementProps(serializedModifier ?? this.#serializeModifier(modifier), includeDisabled),
    ];
  }

  #clickProps(element, includeDisabled) {
    if (!element && !includeDisabled) return [];
    const value = element?.value;
    const serialized = element?.serialized;
    const enabled = Boolean(value && value.enabled !== false);
    return [
      { key: "__arrangeClickableEnabled", value: enabled },
      {
        key: "__arrangeClickCallback",
        value: serialized?.onClick ??
          (typeof value?.onClick === "function" ? this.#serializeValue(value.onClick) : null),
      },
    ];
  }

  #scrollProps(direction, element, includeDisabled) {
    if (!element && !includeDisabled) return [];
    const value = element?.value;
    const serialized = element?.serialized;
    const state = value?.state;
    const enabled = Boolean(value && value.enabled !== false);
    return [
      { key: `__arrange${direction}ScrollEnabled`, value: enabled },
      { key: `__arrange${direction}ScrollValue`, value: typeof state?.value === "number" ? state.value : 0 },
      {
        key: `__arrange${direction}ScrollCallback`,
        value: serialized?.state?.__arrangeNativeScroll ??
          (typeof state?.__arrangeNativeScroll === "function" ? this.#serializeValue(state.__arrangeNativeScroll) : null),
      },
    ];
  }

  #weightProps(element, includeDisabled) {
    if (!element && !includeDisabled) return [];
    return [
      { key: "__arrangeWeight", value: typeof element?.weight === "number" ? element.weight : 0 },
      { key: "__arrangeWeightFill", value: element?.fill !== false },
    ];
  }

  #alignProps(value, includeDisabled) {
    if (value == null && !includeDisabled) return [];
    return [{ key: "__arrangeAlign", value: value ?? "" }];
  }

  #zIndexProps(value, includeDisabled) {
    if (value == null && !includeDisabled) return [];
    return [{ key: "__arrangeZIndex", value: typeof value === "number" ? value : 0 }];
  }

  #layoutOffsetProps(enabled, x, y, includeDisabled) {
    if (!enabled && !includeDisabled) return [];
    return [
      { key: "__arrangeLayoutOffsetX", value: enabled ? x : 0 },
      { key: "__arrangeLayoutOffsetY", value: enabled ? y : 0 },
    ];
  }

  #layerTransformProps(enabled, scaleX, scaleY, rotationZ, originX, originY, includeDisabled) {
    if (!enabled && !includeDisabled) return [];
    return [
      { key: "__arrangeLayerScaleX", value: enabled ? scaleX : 1 },
      { key: "__arrangeLayerScaleY", value: enabled ? scaleY : 1 },
      { key: "__arrangeLayerRotationZ", value: enabled ? rotationZ : 0 },
      { key: "__arrangeLayerTransformOriginX", value: enabled ? originX : 0.5 },
      { key: "__arrangeLayerTransformOriginY", value: enabled ? originY : 0.5 },
    ];
  }

  #modifierElementProps(elements, includeDisabled) {
    if ((!elements || elements.length === 0) && !includeDisabled) return [];
    const props = [{ key: "__arrangeModifierCount", value: elements?.length ?? 0 }];
    elements?.forEach((element, index) => {
      const prefix = `__arrangeModifier.${index}.`;
      props.push({ key: `${prefix}type`, value: element.type });
      for (const [path, value] of flattenModifierValue(element)) {
        if (path === "type") continue;
        props.push({ key: `${prefix}${path}`, value });
      }
    });
    return props;
  }
}

function transformOriginPair(value) {
  if (value === "TopStart") return { x: 0, y: 0 };
  if (value === "TopCenter") return { x: 0.5, y: 0 };
  if (value === "TopEnd") return { x: 1, y: 0 };
  if (value === "CenterStart") return { x: 0, y: 0.5 };
  if (value === "CenterEnd") return { x: 1, y: 0.5 };
  if (value === "BottomStart") return { x: 0, y: 1 };
  if (value === "BottomCenter") return { x: 0.5, y: 1 };
  if (value === "BottomEnd") return { x: 1, y: 1 };
  if (value && typeof value === "object") {
    return {
      x: typeof value.x === "number" ? value.x : 0.5,
      y: typeof value.y === "number" ? value.y : 0.5,
    };
  }
  return { x: 0.5, y: 0.5 };
}

function serializeProp(value) {
  if (typeof value === "function") return "[Function]";
  if (Array.isArray(value)) return value.map(serializeProp);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializeProp(child)]));
  return value;
}

function flattenModifierValue(value, prefix = "") {
  const entries = [];
  if (Array.isArray(value)) {
    value.forEach((child, index) => entries.push(...flattenModifierValue(child, prefix ? `${prefix}.${index}` : String(index))));
    return entries;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) entries.push(...flattenModifierValue(child, path));
      else entries.push([path, child]);
    }
    return entries;
  }
  if (prefix) entries.push([prefix, value]);
  return entries;
}
