import { reactive } from "vue";

let currentFocusManager = null;

export function rememberInteractionState() { return reactive({ hovered: false, pressed: false, focused: false, enabled: true }); }
export function rememberFocusRequester() {
  let requestFocusImpl = null;
  const requester = {
    requested: false,
    requestFocus() {
      this.requested = true;
      if (typeof requestFocusImpl !== "function") return false;
      this.requested = false;
      return requestFocusImpl();
    },
  };
  Object.defineProperty(requester, "__arrangeBind", {
    enumerable: false,
    value(callback) {
      requestFocusImpl = callback;
      if (requester.requested) requester.requestFocus();
    },
  });
  return requester;
}
export function useFocusManager() { return { clearFocus() { return currentFocusManager?.clearFocus() ?? false; } }; }
export function __arrangeSetFocusManager(manager) { currentFocusManager = manager ?? null; }
export function rememberScrollState(args = {}) {
  let state;
  state = reactive({
    value: args.initial ?? 0,
    maxValue: 0,
    viewportSize: 0,
    contentSize: 0,
    isScrollInProgress: false,
    canScrollBackward: false,
    canScrollForward: false,
    scrollTo(value) { applyScrollSnapshot(state, { value }); },
    animateScrollTo(value) { this.scrollTo(value); },
    __arrangeNativeScroll(payload) { applyScrollSnapshot(state, typeof payload === "string" ? JSON.parse(payload) : payload); },
  });
  applyScrollSnapshot(state, state);
  return state;
}
function applyScrollSnapshot(state, snapshot = {}) {
  if (typeof snapshot.value === "number") state.value = snapshot.value;
  if (typeof snapshot.maxValue === "number") state.maxValue = snapshot.maxValue;
  if (typeof snapshot.viewportSize === "number") state.viewportSize = snapshot.viewportSize;
  if (typeof snapshot.contentSize === "number") state.contentSize = snapshot.contentSize;
  state.canScrollBackward = state.value > 0;
  state.canScrollForward = state.value < state.maxValue;
  state.isScrollInProgress = Boolean(snapshot.isScrollInProgress ?? false);
  return state;
}
export function rememberLazyListState(args = {}) { return { firstVisibleItemIndex: args.initialFirstVisibleItemIndex ?? 0, firstVisibleItemScrollOffset: args.initialFirstVisibleItemScrollOffset ?? 0, visibleItemsInfo: [], totalItemsCount: 0, viewportStartOffset: 0, viewportEndOffset: 0, isScrollInProgress: false, canScrollBackward: false, canScrollForward: false, scrollToItem(index, scrollOffset = 0) { this.firstVisibleItemIndex = index; this.firstVisibleItemScrollOffset = scrollOffset; }, animateScrollToItem(index, scrollOffset = 0) { this.scrollToItem(index, scrollOffset); } }; }
export function rememberLazyGridState(args = {}) { return rememberLazyListState(args); }
export function rememberInputState(args = {}) { return { value: args.value ?? "", selectionStart: 0, selectionEnd: 0 }; }
export function rememberCanvasController() { return { invalidate() { this.invalidated = true; }, invalidated: false }; }
export function useParameter(id) { let value = 0; return { id, get value() { return value; }, get normalizedValue() { return value; }, set(next) { value = next; }, setNormalized(next) { value = next; }, gesture() { return { begin() {}, set(next) { value = next; }, end() {} }; } }; }
export function useHost() { return {}; }
export function useTransport() { return { playing: false, bpm: null, positionPpq: null }; }
