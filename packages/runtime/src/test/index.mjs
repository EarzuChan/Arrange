import { evaluateRoot } from "../components.mjs";
import { renderVNode, collectDrawOps } from "../layout.mjs";
import { __arrangeSetFocusManager } from "../state.mjs";

export { h, evaluateRoot } from "../components.mjs"
export { BridgeOpWriter, renderToBridgeBatch, renderToBridgeOps } from "../renderer.mjs"

export async function renderArrange(root, options = {}) {
  const vnode = evaluateRoot(typeof root === "function" ? root : () => root);
  const tree = renderVNode(vnode, options);
  return new ArrangeTestRule(tree);
}

export class ArrangeTestRule {
  constructor(tree) {
    this.tree = tree;
    this.focusedNode = null;
    __arrangeSetFocusManager({ clearFocus: () => this.clearFocus() });
    bindFocusRequesters(this, tree);
  }

  node(tag) {
    const found = findByTag(this.tree, tag);
    if (!found) throw new Error(`No Arrange node found with testTag(${tag})`);
    return new ArrangeNodeSubject(found, this);
  }

  snapshot() { return snapshotNode(this.tree); }
  drawOps() { return collectDrawOps(this.tree); }
  clearFocus() { return clearFocusedNode(this); }
  performKey(key) { return performKey(this, key); }
  async waitForIdle() {}
}

export class ArrangeNodeSubject {
  constructor(node, rule) {
    this.node = node;
    this.rule = rule;
  }

  bounds() { return { x: this.node.x, y: this.node.y, width: this.node.width, height: this.node.height }; }
  baseline() { return this.node.baseline; }
  text() { return this.node.vnode?.props?.text; }
  isFocused() { return this.rule.focusedNode === this.node; }
  requestFocus() { return focusNode(this.rule, this.node); }
  performHoverEnter() { return hoverNode(this.node, true); }
  performHoverExit() { return hoverNode(this.node, false); }
  performClick() {
    if (!this.node.clickable?.enabled) return false;
    if (this.node.focusable) focusNode(this.rule, this.node);
    this.node.clickable?.onClick?.();
    return Boolean(this.node.clickable?.onClick);
  }
}

function findByTag(node, tag) {
  if (node.tags?.includes(tag)) return node;
  for (const child of node.children ?? []) {
    const found = findByTag(child, tag);
    if (found) return found;
  }
  return null;
}

function snapshotNode(node) {
  return {
    type: node.type,
    tags: node.tags ?? [],
    bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
    baseline: node.baseline,
    children: (node.children ?? []).map(snapshotNode),
  };
}

function bindFocusRequesters(rule, node) {
  const requester = node.focusRequester;
  if (requester) {
    if (typeof requester.__arrangeBind === "function") requester.__arrangeBind(() => focusNode(rule, node));
    else requester.requestFocus = () => focusNode(rule, node);
  }
  for (const child of node.children ?? []) bindFocusRequesters(rule, child);
}

function focusNode(rule, node) {
  if (!node.focusable) return false;
  if (rule.focusedNode === node) return true;
  clearFocusedNode(rule);
  rule.focusedNode = node;
  notifyFocus(node, true);
  return true;
}

function clearFocusedNode(rule) {
  if (!rule.focusedNode) return false;
  const previous = rule.focusedNode;
  rule.focusedNode = null;
  notifyFocus(previous, false);
  return true;
}

function notifyFocus(node, focused) {
  if (node.interactionState) node.interactionState.focused = focused;
  node.onFocusChanged?.({ focused, isFocused: focused, hasFocus: focused });
}

function hoverNode(node, hovered) {
  if (!node.hoverable?.enabled) return false;
  if (node.interactionState) node.interactionState.hovered = hovered;
  if (hovered) node.hoverable.onEnter?.();
  else node.hoverable.onExit?.();
  return true;
}

function performKey(rule, key) {
  const node = rule.focusedNode;
  if (!node?.clickable?.enabled) return false;
  if (key !== "Enter" && key !== "Space" && key !== " ") return false;
  node.clickable.onClick?.();
  return Boolean(node.clickable.onClick);
}
