import { createRenderer } from "vue";
import { Text } from "./components.mjs";
import { m, toModifier } from "./modifier.mjs";
import { BRIDGE_VERSION } from "./bridge.mjs";

function normalizeChildren(children) {
  return Array.isArray(children) ? children : [];
}

function makeNode(type) {
  const node = {
    $$arrangeVNode: true,
    type,
    tagName: String(type).toUpperCase(),
    props: { modifier: m },
    children: [],
    __arrangeListeners: new Map(),
    addEventListener(name, listener) {
      const list = this.__arrangeListeners.get(name) ?? [];
      list.push(listener);
      this.__arrangeListeners.set(name, list);
    },
    removeEventListener(name, listener) {
      const list = this.__arrangeListeners.get(name);
      if (!list) return;
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    getRootNode() {
      return { activeElement: null };
    },
    dispatchArrangeEvent(name, value = this.value) {
      this.value = value;
      const event = { target: this, currentTarget: this, type: name };
      for (const listener of this.__arrangeListeners.get(name) ?? []) listener(event);
    },
  };
  Object.defineProperty(node, "value", {
    configurable: true,
    get() {
      return this.props.modelValue ?? this.props["model-value"] ?? this.props.value ?? "";
    },
    set(next) {
      const value = next == null ? "" : String(next);
      this.props.modelValue = value;
      this.props.value = value;
      scheduleCommitFrom(this);
    },
  });
  return node;
}

function makeTextNode(text) {
  const node = makeNode(Text);
  node.props.text = String(text);
  return node;
}

function findContainer(node) {
  let current = node;
  while (current && !current.$$arrangeContainer) current = current.__arrangeParent ?? null;
  return current?.$$arrangeContainer ? current : null;
}

function currentTree(container) {
  return container?.children?.[0] ?? null;
}

function bridgeType(node) {
  return typeof node?.type === "string" ? node.type : String(node?.type ?? "Unknown");
}

function nativeModifierProps(modifier, includeDisabled = false) {
    const scroll = {
        vertical: null,
        horizontal: null,
    }
    let clickable = null
    let weight = null
    let align = null
    let zIndex = null
    let layoutOffsetX = 0
    let layoutOffsetY = 0
    let hasLayoutOffset = false
    let hasLayer = false
    let layerScaleX = 1
    let layerScaleY = 1
    let layerRotationZ = 0
    let layerOriginX = 0.5
    let layerOriginY = 0.5

    for (const element of modifier?.elements ?? []) {
        if (element.type === "verticalScroll") scroll.vertical = element.value ?? {}
        if (element.type === "horizontalScroll") scroll.horizontal = element.value ?? {}
        if (element.type === "clickable") clickable = element.value ?? {}
        if (element.type === "weight") weight = element.value ?? {}
        if (element.type === "align" && align == null) align = element.value?.alignment ?? ""
        if (element.type === "zIndex") zIndex = element.value?.value ?? 0
        if (element.type === "offset" || element.type === "absoluteOffset") {
            layoutOffsetX += typeof element.value?.x === "number" ? element.value.x : 0
            layoutOffsetY += typeof element.value?.y === "number" ? element.value.y : 0
            hasLayoutOffset = true
        }
        if (element.type === "graphicsLayer") {
            layoutOffsetX += typeof element.value?.translationX === "number" ? element.value.translationX : 0
            layoutOffsetY += typeof element.value?.translationY === "number" ? element.value.translationY : 0
            hasLayoutOffset = true
            hasLayer = true
            layerScaleX = typeof element.value?.scaleX === "number" ? element.value.scaleX : 1
            layerScaleY = typeof element.value?.scaleY === "number" ? element.value.scaleY : 1
            layerRotationZ = typeof element.value?.rotationZ === "number" ? element.value.rotationZ : 0
            const origin = transformOriginPair(element.value?.transformOrigin)
            layerOriginX = origin.x
            layerOriginY = origin.y
        }
    }

    const props = []
    appendClickProps(props, clickable, includeDisabled)
    appendScrollProps(props, "Vertical", scroll.vertical, includeDisabled)
    appendScrollProps(props, "Horizontal", scroll.horizontal, includeDisabled)
    appendWeightProps(props, weight, includeDisabled)
    appendAlignProps(props, align, includeDisabled)
    appendZIndexProps(props, zIndex, includeDisabled)
    appendLayoutOffsetProps(props, hasLayoutOffset, layoutOffsetX, layoutOffsetY, includeDisabled)
    appendLayerTransformProps(props, hasLayer, layerScaleX, layerScaleY, layerRotationZ, layerOriginX, layerOriginY, includeDisabled)
    appendModifierElementProps(props, modifier?.elements ?? [], includeDisabled)
    return props
}

function transformOriginPair(value) {
    if (value === "TopStart") return { x: 0, y: 0 }
    if (value === "TopCenter") return { x: 0.5, y: 0 }
    if (value === "TopEnd") return { x: 1, y: 0 }
    if (value === "CenterStart") return { x: 0, y: 0.5 }
    if (value === "CenterEnd") return { x: 1, y: 0.5 }
    if (value === "BottomStart") return { x: 0, y: 1 }
    if (value === "BottomCenter") return { x: 0.5, y: 1 }
    if (value === "BottomEnd") return { x: 1, y: 1 }
    if (value && typeof value === "object") {
        return {
            x: typeof value.x === "number" ? value.x : 0.5,
            y: typeof value.y === "number" ? value.y : 0.5,
        }
    }
    return { x: 0.5, y: 0.5 }
}

function appendClickProps(props, element, includeDisabled) {
    if (!element && !includeDisabled) return
    const enabled = Boolean(element && element.enabled !== false)
    props.push({ key: "__arrangeClickableEnabled", value: enabled })
    props.push({
        key: "__arrangeClickCallback",
        value: typeof element?.onClick === "function" ? element.onClick : null,
    })
}

function appendScrollProps(props, direction, element, includeDisabled) {
    if (!element && !includeDisabled) return
    const state = element?.state
    const enabled = Boolean(element && element.enabled !== false)
    props.push({ key: `__arrange${direction}ScrollEnabled`, value: enabled })
    props.push({ key: `__arrange${direction}ScrollValue`, value: typeof state?.value === "number" ? state.value : 0 })
    props.push({ key: `__arrange${direction}ScrollCallback`, value: state?.__arrangeNativeScroll ?? null })
}

function appendWeightProps(props, element, includeDisabled) {
    if (!element && !includeDisabled) return
    props.push({ key: "__arrangeWeight", value: typeof element?.weight === "number" ? element.weight : 0 })
    props.push({ key: "__arrangeWeightFill", value: element?.fill !== false })
}

function appendAlignProps(props, value, includeDisabled) {
    if (value == null && !includeDisabled) return
    props.push({ key: "__arrangeAlign", value: value ?? "" })
}

function appendZIndexProps(props, value, includeDisabled) {
    if (value == null && !includeDisabled) return
    props.push({ key: "__arrangeZIndex", value: typeof value === "number" ? value : 0 })
}

function appendLayoutOffsetProps(props, enabled, x, y, includeDisabled) {
    if (!enabled && !includeDisabled) return
    props.push({ key: "__arrangeLayoutOffsetX", value: enabled ? x : 0 })
    props.push({ key: "__arrangeLayoutOffsetY", value: enabled ? y : 0 })
}

function appendLayerTransformProps(props, enabled, scaleX, scaleY, rotationZ, originX, originY, includeDisabled) {
    if (!enabled && !includeDisabled) return
    props.push({ key: "__arrangeLayerScaleX", value: enabled ? scaleX : 1 })
    props.push({ key: "__arrangeLayerScaleY", value: enabled ? scaleY : 1 })
    props.push({ key: "__arrangeLayerRotationZ", value: enabled ? rotationZ : 0 })
    props.push({ key: "__arrangeLayerTransformOriginX", value: enabled ? originX : 0.5 })
    props.push({ key: "__arrangeLayerTransformOriginY", value: enabled ? originY : 0.5 })
}

function appendModifierElementProps(props, elements, includeDisabled) {
    if ((!elements || elements.length === 0) && !includeDisabled) return
    props.push({ key: "__arrangeModifierCount", value: elements?.length ?? 0 })
    elements?.forEach((element, index) => {
        const prefix = `__arrangeModifier.${index}.`
        props.push({ key: `${prefix}type`, value: element.type })
        const value = serializableModifierValue(element.value ?? {})
        for (const [path, child] of flattenModifierValue({ type: element.type, ...value })) {
            if (path === "type") continue
            props.push({ key: `${prefix}${path}`, value: child })
        }
    })
}

function serializableModifierValue(value) {
    if (typeof value === "function") return null
    if (Array.isArray(value)) return value.map(serializableModifierValue)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializableModifierValue(child)]))
    return value
}

function flattenModifierValue(value, prefix = "") {
    const entries = []
    if (Array.isArray(value)) {
        value.forEach((child, index) => entries.push(...flattenModifierValue(child, prefix ? `${prefix}.${index}` : String(index))))
        return entries
    }
    if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            const path = prefix ? `${prefix}.${key}` : key
            if (child && typeof child === "object" && !Array.isArray(child)) entries.push(...flattenModifierValue(child, path))
            else entries.push([path, child])
        }
        return entries
    }
    if (prefix) entries.push([prefix, value])
    return entries
}

function assignBridgeIds(node, container) {
  if (!node || typeof node !== "object") return;
  if (!node.__arrangeBridgeId) node.__arrangeBridgeId = container.__arrangeNextBridgeId++;
  for (const child of node.children ?? []) assignBridgeIds(child, container);
}

function emitCreateSubtree(node, parentId = null, index = 0, ops = []) {
  if (!node?.__arrangeBridgeId) return ops;
  const id = node.__arrangeBridgeId;
  ops.push({ op: "createNode", id, nodeType: bridgeType(node) });
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === "modifier") continue;
    if (key === "text" && node.type === Text) ops.push({ op: "setText", id, text: String(value) });
    else ops.push({ op: "setProp", id, key, value });
  }
  const modifier = node.props?.modifier;
  if (modifier?.elements?.length) {
    ops.push({ op: "setModifier", id, modifier });
    for (const prop of nativeModifierProps(modifier)) ops.push({ op: "setProp", id, ...prop });
  }
  if (parentId != null) ops.push({ op: "insertChild", parent: parentId, child: id, index });
  node.children?.forEach((child, childIndex) => emitCreateSubtree(child, id, childIndex, ops));
  return ops;
}

function assertNativeProtocol(target) {
  const nativeVersion = target?.protocolVersion ?? target?.bridgeVersion;
  if (nativeVersion == null) return;
  if (nativeVersion !== BRIDGE_VERSION) {
    throw new Error(`Arrange runtime/native bridge version mismatch: runtime=${BRIDGE_VERSION}, native=${nativeVersion}`);
  }
}

function scheduleCommitFrom(node) {
  const container = findContainer(node);
  if (!container?.__arrangeMounted || typeof container.__arrangeCommit !== "function") return;
  if (container.__arrangeCommitPending) return;
  container.__arrangeCommitPending = true;
  queueMicrotask(() => {
    container.__arrangeCommitPending = false;
    if (!container.__arrangeMounted) return;
    const ops = container.__arrangePendingOps.splice(0);
    if (ops.length > 0) container.__arrangeCommit(ops);
  });
}

function enqueueBridgeOps(node, ops) {
  const container = findContainer(node);
  if (!container?.__arrangeMounted || typeof container.__arrangeCommit !== "function") return false;
  if (!Array.isArray(ops)) ops = [ops];
  container.__arrangePendingOps.push(...ops);
  scheduleCommitFrom(node);
  return true;
}

function clearBridgeIds(node) {
  if (!node || typeof node !== "object") return;
  delete node.__arrangeBridgeId;
  for (const child of node.children ?? []) clearBridgeIds(child);
}

const renderer = createRenderer({
  patchProp(el, key, _previous, next) {
    if (key === "class" || key === "style") return;
    el.props[key] = key === "modifier" ? toModifier(next ?? m) : next;
    if (!el.__arrangeBridgeId) return;
    if (key === "modifier") {
      enqueueBridgeOps(el, [
        { op: "setModifier", id: el.__arrangeBridgeId, modifier: el.props.modifier },
        ...nativeModifierProps(el.props.modifier, true).map((prop) => ({ op: "setProp", id: el.__arrangeBridgeId, ...prop })),
      ]);
    }
    else if (key === "text" && el.type === Text) enqueueBridgeOps(el, { op: "setText", id: el.__arrangeBridgeId, text: String(next) });
    else enqueueBridgeOps(el, { op: "setProp", id: el.__arrangeBridgeId, key, value: el.props[key] });
  },
  insert(child, parent, anchor = null) {
    parent.children ??= [];
    const current = parent.children.indexOf(child);
    if (current >= 0) parent.children.splice(current, 1);
    child.__arrangeParent = parent;
    if (anchor == null) parent.children.push(child);
    else {
      const index = parent.children.indexOf(anchor);
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
    }
    const container = findContainer(parent);
    if (container?.__arrangeMounted && parent.__arrangeBridgeId) {
      const existingId = child.__arrangeBridgeId;
      if (!existingId) assignBridgeIds(child, container);
      const index = parent.children.indexOf(child);
      enqueueBridgeOps(parent, existingId
        ? { op: "insertChild", parent: parent.__arrangeBridgeId, child: existingId, index }
        : emitCreateSubtree(child, parent.__arrangeBridgeId, index, []));
    }
  },
  remove(child) {
    const parent = child.__arrangeParent;
    if (!parent?.children) return;
    const parentId = parent.__arrangeBridgeId;
    const childId = child.__arrangeBridgeId;
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
    child.__arrangeParent = null;
    if (parentId && childId) {
      enqueueBridgeOps(parent, [
        { op: "removeChild", parent: parentId, child: childId },
        { op: "deleteNode", id: childId },
      ]);
      clearBridgeIds(child);
    }
  },
  createElement(type) {
    return makeNode(type);
  },
  createText(text) {
    return makeTextNode(text);
  },
  createComment(text) {
    const node = makeNode("Comment");
    node.props.text = String(text ?? "");
    return node;
  },
  setText(node, text) {
    node.props.text = String(text);
    if (node.__arrangeBridgeId) enqueueBridgeOps(node, { op: "setText", id: node.__arrangeBridgeId, text: String(text) });
  },
  setElementText(node, text) {
    node.children = [];
    if (node.type === Text) node.props.text = String(text);
    else if (text !== "") {
      const child = makeTextNode(text);
      child.__arrangeParent = node;
      node.children.push(child);
    }
    if (node.__arrangeBridgeId) {
      if (node.type === Text) enqueueBridgeOps(node, { op: "setText", id: node.__arrangeBridgeId, text: String(text) });
      else enqueueBridgeOps(node, { op: "mount", tree: currentTree(findContainer(node)) });
    }
  },
  parentNode(node) {
    return node.__arrangeParent ?? null;
  },
  nextSibling(node) {
    const parent = node.__arrangeParent;
    if (!parent?.children) return null;
    const index = parent.children.indexOf(node);
    return index >= 0 ? parent.children[index + 1] ?? null : null;
  },
});

export function createApp(rootComponent, rootProps = null) {
  const app = renderer.createApp(rootComponent, rootProps);
  const originalMount = app.mount;
  const originalUnmount = app.unmount.bind(app);
  let container = null;
  let nativeTarget = null;

  app.unmount = () => {
    if (!container) return originalUnmount();
    const target = nativeTarget;
    originalUnmount();
    container.__arrangeMounted = false;
    container.__arrangeCommitPending = false;
    if (target && typeof target.commit === "function") target.commit([{ op: "unmount" }]);
    container = null;
    nativeTarget = null;
  };

  app.mount = (target = globalThis.__ARRANGE_NATIVE__) => {
    assertNativeProtocol(target);
    nativeTarget = target;
    container = {
      $$arrangeContainer: true,
      children: [],
      __arrangeCommit: target?.commit?.bind(target),
      __arrangeCommitPending: false,
      __arrangeMounted: false,
      __arrangeNextBridgeId: 1,
      __arrangePendingOps: [],
    };
    globalThis.Document ??= function ArrangeDocument() {};
    globalThis.ShadowRoot ??= function ArrangeShadowRoot() {};
    const result = originalMount(container);
    assignBridgeIds(currentTree(container), container);
    container.__arrangeMounted = true;
    if (target && typeof target.commit === "function") target.commit([{ op: "mount", tree: currentTree(container) }]);

    if (result && (typeof result === "object" || typeof result === "function")) {
      try {
        Object.defineProperty(result, "tree", { configurable: true, get: () => currentTree(container) });
        Object.defineProperty(result, "unmount", { configurable: true, value: () => app.unmount() });
        return result;
      } catch {
        // Vue component public instances are proxies; if a host rejects augmentation,
        // fall through to the minimal Arrange mount handle used by tests/smoke.
      }
    }
    return { tree: currentTree(container), unmount: () => app.unmount() };
  };
  return app;
}
