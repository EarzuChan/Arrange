#include <arrange/core/InputSession.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <cstdlib>
#include <limits>
#include <tuple>
#include <unordered_map>

namespace arrange::core {
    namespace {
        bool descendant(const LayoutTree& tree, NodeId child, NodeId parent) {
            const auto path = nodePath(tree, child);
            return std::find(path.begin(), path.end(), parent) != path.end();
        }

        struct LazyItemLocation {
            NodeId container;
            NodeId wrapper;
            int index;
        };

        std::optional<LazyItemLocation> lazyItem(const LayoutTree& tree, NodeId child) {
            const auto path = nodePath(tree, child);
            for (std::size_t i = path.size(); i > 1; --i) {
                const auto& parent = tree.node(path[i - 2]);
                const auto* policy = std::get_if<LazyMeasurePolicy>(&parent.measurePolicy);
                if (!policy) continue;
                const auto found = std::find(parent.children.begin(), parent.children.end(), path[i - 1]);
                const auto position = static_cast<std::size_t>(found - parent.children.begin());
                if (found != parent.children.end() && position < policy->indices.size()) return LazyItemLocation{parent.id, *found, policy->indices[position]};
            }
            return {};
        }

        bool backwards(FocusDirection direction) {
            return direction == FocusDirection::Previous || direction == FocusDirection::Up || direction == FocusDirection::Left;
        }
    }

    void InputSession::reset() {
        focus_.reset();
        preparedInputEvents_.clear();
        pendingLazyFocus_.reset();
        lazyFocusVersion_ = 0;
        pointer_.resetForSceneChange();
    }

    void InputSession::commitState(InputSession&& candidate) noexcept {
        pointer_ = std::move(candidate.pointer_);
        focus_ = std::move(candidate.focus_);
        preparedInputEvents_ = std::move(candidate.preparedInputEvents_);
        pendingLazyFocus_ = std::move(candidate.pendingLazyFocus_);
        lazyFocusVersion_ = candidate.lazyFocusVersion_;
    }

    void InputSession::notePointerEffects(const PointerGestureOutput& output) noexcept {
        if (output.lockPointer) {
            effects_.lockPointer = true;
            effects_.unlockPointer = false;
        }
        if (output.unlockPointer) {
            effects_.unlockPointer = true;
            effects_.lockPointer = false;
            effects_.restorePoint = output.restorePoint;
        }
    }

    PointerGestureOutput InputSession::pointerDown(LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, TextInputBridge& text, const InputCallbacks& callbacks, PointerDownOptions options) {
        pendingLazyFocus_.reset();
        PointerGestureOutput gesture;
        const auto pointerResult = pointer_.pointerDown(tree, snapshot, sample, options.clickCount, gesture);
        focus_.synchronize(tree, true);
        (void)focus_.set(pointerFocusTarget(tree, focus_.snapshot(), pointerResult.hit.node, sample.point));
        text.pointerDown(tree, pointerResult.hit, sample.point.x, sample.point.y, callbacks, options);
        dispatchCommittedFocus(tree, text, callbacks);
        return gesture;
    }

    bool InputSession::pointerDrag(LayoutTree& tree, bool runtimeReady, const PointerSample& sample, TextInputBridge& text, const InputCallbacks& callbacks, PointerGestureOutput* gesture) {
        PointerGestureOutput local;
        pointer_.pointerDrag(tree, sample, gesture ? *gesture : local);
        // 拖动会话独占指针，不再交给文本拖选
        if (pointer_.gesture().dragging()) {
            text.cancelDrag();
            return true;
        }
        return text.pointerDrag(tree, runtimeReady, sample.point.x, sample.point.y, callbacks);
    }

    PointerUpResult InputSession::pointerUp(LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, TextInputBridge& text) {
        text.cancelDrag();
        PointerUpResult result;
        pointer_.pointerUp(tree, snapshot, sample, result.gesture);
        for (const auto& event : result.gesture.events)
            if (std::holds_alternative<std::monostate>(event.payload)) {
                result.clickTriggered = true;
                result.eventSlot = event.slot;
            }
        return result;
    }

    PointerGestureOutput InputSession::pointerMove(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample) {
        PointerGestureOutput gesture;
        pointer_.gesture().move(tree, snapshot, sample, gesture);
        return gesture;
    }

    PointerGestureOutput InputSession::pointerExit(const LayoutTree& tree) {
        PointerGestureOutput gesture;
        pointer_.gesture().exit(tree, gesture);
        return gesture;
    }

    PointerGestureOutput InputSession::contextClick(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample) {
        PointerGestureOutput gesture;
        pointer_.gesture().contextClick(tree, snapshot, sample, gesture);
        return gesture;
    }

    PointerGestureOutput InputSession::cancelPointer(const LayoutTree& tree, TextInputBridge& text) {
        PointerGestureOutput gesture;
        text.cancelDrag();
        pointer_.cancelWheel();
        pointer_.gesture().cancel(tree, gesture);
        return gesture;
    }

    bool InputSession::bubbleKey(const LayoutTree& tree, const KeyEventPayload& payload, const InputCallbacks& callbacks) const {
        if (!focusedNode() || !tree.contains(*focusedNode()) || !callbacks.dispatchKeyEvent) return false;
        // 先收集槽位再调用：焦点受体在前，同节点内层 Modifier 在前
        std::vector<EventSlotId> slots;
        const auto path = nodePath(tree, *focusedNode());
        for (auto node = path.rbegin(); node != path.rend(); ++node) {
            const auto& elements = tree.node(*node).modifier.elements();
            for (auto element = elements.rbegin(); element != elements.rend(); ++element)
                if (const auto* input = std::get_if<InputModifierSemantics>(&element->descriptor.value); input && input->kind == InputModifierKind::KeyEvent && input->enabled && input->eventSlot.valid()) slots.push_back(input->eventSlot);
        }
        for (const auto& slot : slots)
            if (callbacks.dispatchKeyEvent(slot, payload)) return true;
        return false;
    }

    bool InputSession::keyDown(LayoutTree& tree, bool runtimeReady, const KeyInput& key, TextInputBridge& text, const InputCallbacks& callbacks) {
        if (!runtimeReady) return false;
        focus_.synchronize(tree, runtimeReady);
        auto pressed = std::find_if(pressedKeys_.begin(), pressedKeys_.end(), [&](const auto& item) { return item.code == key.code; });
        const auto repeat = pressed != pressedKeys_.end();
        if (!repeat) pressed = pressedKeys_.insert(pressedKeys_.end(), {key.code, key.key, key.text, false});
        const auto tab = key.key == "Tab";
        // Input 先消费编辑按键；Tab 不交给 Input
        if (!tab && text.keyPressed(tree, runtimeReady, key, callbacks)) return true;
        if (callbacks.enqueueKeyIntent) callbacks.enqueueKeyIntent(focusedNode().value_or(0));
        pressed->delivered = true;
        if (bubbleKey(tree, {false, pressed->key, pressed->text, repeat, key.modifiers}, callbacks)) return true;
        if (tab) return moveFocus(tree, key.modifiers.shift ? FocusDirection::Previous : FocusDirection::Next, text, callbacks);
        // Enter / Space 按下只进入激活待定，抬起才激活；重复不连发
        if (focus_.target() && (key.key == "Enter" || key.key == " ") && focus_.target()->click.valid()) {
            if (!repeat) activation_ = KeyActivation{key.code, focus_.target()->node.id};
            return true;
        }
        if (key.key == "ArrowUp") return moveFocus(tree, FocusDirection::Up, text, callbacks);
        if (key.key == "ArrowDown") return moveFocus(tree, FocusDirection::Down, text, callbacks);
        if (key.key == "ArrowLeft") return moveFocus(tree, FocusDirection::Left, text, callbacks);
        if (key.key == "ArrowRight") return moveFocus(tree, FocusDirection::Right, text, callbacks);
        if (focusedNode()) {
            const auto operation = key.key == "PageUp" ? -1 : key.key == "PageDown" ? 1 : key.key == "Home" ? -2 : key.key == "End" ? 2 : 0;
            if (operation)
                if (auto scroll = focusKeyboardScroll(tree, *focusedNode(), operation)) {
                    if (scroll->second.consumed && callbacks.invokeScrollEvent) callbacks.invokeScrollEvent(scroll->first, scroll->second);
                    return true;
                }
        }
        return false;
    }

    bool InputSession::keyStateChanged(LayoutTree& tree, bool runtimeReady, const std::function<bool(int)>& isDown, const InputCallbacks& callbacks) {
        auto consumed = false;
        for (auto index = pressedKeys_.size(); index-- > 0;) {
            const auto key = pressedKeys_[index];
            if (isDown && isDown(key.code)) continue;
            pressedKeys_.erase(pressedKeys_.begin() + static_cast<std::ptrdiff_t>(index));
            if (!runtimeReady) continue;
            if (key.delivered) consumed = bubbleKey(tree, {true, key.key, key.text, false, modifiers_}, callbacks) || consumed;
            if (activation_ && activation_->code == key.code) {
                const auto activation = *std::exchange(activation_, std::nullopt);
                focus_.synchronize(tree, runtimeReady);
                // 失焦补发的抬起不激活
                if (isDown && focus_.target() && focus_.target()->node.id == activation.node && focus_.target()->click.valid() && callbacks.invokeEvent) callbacks.invokeEvent(focus_.target()->click);
                consumed = true;
            }
        }
        return consumed;
    }

    void InputSession::modifierKeysChanged(LayoutTree& tree, bool runtimeReady, KeyModifierState modifiers, const InputCallbacks& callbacks) {
        const auto previous = std::exchange(modifiers_, modifiers);
        if (!runtimeReady) return;
        const std::tuple<bool, bool, const char*> changes[]{{previous.shift, modifiers.shift, "Shift"}, {previous.ctrl, modifiers.ctrl, "Control"}, {previous.alt, modifiers.alt, "Alt"}, {previous.meta, modifiers.meta, "Meta"}};
        for (const auto& [before, after, name] : changes)
            if (before != after) (void)bubbleKey(tree, {!after, name, {}, false, modifiers}, callbacks);
    }

    void InputSession::synchronizePublishedFocus(const LayoutTree& tree, bool runtimeReady, TextInputBridge& text, const std::vector<FocusCommand>& commands) {
        if (!runtimeReady || std::any_of(commands.begin(), commands.end(), [](const auto& command) { return command.kind != FocusCommandKind::Cancel; })) pendingLazyFocus_.reset();
        focus_.synchronize(tree, runtimeReady, commands);
        resolveLazyFocus(tree);
        InputCallbacks deferred;
        deferred.invokeStringEvent = [this](const auto& slot, const auto& value) {
            preparedInputEvents_.emplace_back(slot, value);
        };
        if (focus_.target() && focus_.target()->editable)
            text.focus(tree, focus_.target()->node.id, focus_.target()->modifier, deferred);
        else
            text.finishFocusedInput(tree, false, deferred);
    }

    void InputSession::dispatchCommittedFocus(LayoutTree& tree, TextInputBridge& text, const InputCallbacks& callbacks) {
        for (const auto& [slot, value] : std::exchange(preparedInputEvents_, {}))
            if (callbacks.invokeStringEvent) callbacks.invokeStringEvent(slot, value);
        const auto changes = focus_.takeChanges();
        for (const auto& change : changes)
            if (callbacks.invokeFocusEvent) callbacks.invokeFocusEvent(change.slot, change.isFocused, change.hasFocus);
        const auto changed = focus_.takeIdentityChange();
        if (changed && focusChangedHook_) focusChangedHook_(focusedNode());
        if (changed && callbacks.invalidateNativeState) {
            for (const auto id : tree.nodeIds()) {
                const auto& node = tree.node(id);
                if (node.lazy && (!node.lazy->pinnedKeys.empty() || !node.lazy->focusRequestKey.empty()) || focusedNode() && std::holds_alternative<LazyMeasurePolicy>(node.measurePolicy) && descendant(tree, *focusedNode(), id)) callbacks.invalidateNativeState(id, DirtyFlag::Layout);
            }
        }
        if (focus_.takeScrollRequest() && focus_.target()) {
            if (focusChangedHook_) focusChangedHook_(focusedNode());
            for (const auto& [slot, scroll] : focusScrollIntoView(tree, *focus_.target()))
                if (callbacks.invokeScrollEvent) callbacks.invokeScrollEvent(slot, scroll);
        }
        for (const auto direction : focus_.takeMoves()) (void)moveFocus(tree, direction, text, callbacks);
    }

    bool InputSession::requestFocus(LayoutTree& tree, NodeId node, TextInputBridge& text, const InputCallbacks& callbacks) {
        pendingLazyFocus_.reset();
        focus_.synchronize(tree, true);
        for (const auto& target : focus_.snapshot())
            if (target.node.id == node) {
                const auto changed = focus_.set(target);
                if (target.editable)
                    text.focus(tree, node, target.modifier, callbacks);
                else
                    text.finishFocusedInput(tree, false, callbacks);
                if (changed && callbacks.invalidateNativeState) callbacks.invalidateNativeState(node, DirtyFlag::Paint);
                dispatchCommittedFocus(tree, text, callbacks);
                return true;
            }
        return false;
    }

    bool InputSession::moveFocus(LayoutTree& tree, FocusDirection direction, TextInputBridge& text, const InputCallbacks& callbacks) {
        focus_.synchronize(tree, true);
        if (focus_.target() && focus_.target()->directions[static_cast<std::size_t>(direction)]) {
            const auto target = findFocusRequester(focus_.snapshot(), focus_.target()->directions[static_cast<std::size_t>(direction)]);
            return target && requestFocus(tree, target->node.id, text, callbacks);
        }
        if (navigateLazy(tree, direction, callbacks)) return true;
        if (focusedNode() && navigationHook_ && navigationHook_(*focusedNode(), direction)) return true;
        const auto target = searchFocus(focus_.snapshot(), focus_.target(), direction);
        return target && requestFocus(tree, target->node.id, text, callbacks);
    }

    void InputSession::clearFocus(LayoutTree& tree, TextInputBridge& text, const InputCallbacks& callbacks) {
        pendingLazyFocus_.reset();
        const auto previous = focusedNode();
        (void)focus_.set({});
        text.finishFocusedInput(tree, false, callbacks);
        if (previous && callbacks.invalidateNativeState) callbacks.invalidateNativeState(*previous, DirtyFlag::Paint);
        dispatchCommittedFocus(tree, text, callbacks);
        if (focusChangedHook_) focusChangedHook_({});
    }

    bool InputSession::navigateLazy(LayoutTree& tree, FocusDirection direction, const InputCallbacks& callbacks) {
        if (!focusedNode()) return false;
        const auto location = lazyItem(tree, *focusedNode());
        if (!location) return false;
        const auto& container = tree.node(location->container);
        const auto& policy = std::get<LazyMeasurePolicy>(container.measurePolicy);
        if (!pendingLazyFocus_)
            if (const auto candidate = searchFocus(focus_.snapshot(), focus_.target(), direction); candidate && descendant(tree, candidate->node.id, location->wrapper)) return false;
        const auto previous = backwards(direction);
        auto currentIndex = location->index;
        if (pendingLazyFocus_ && pendingLazyFocus_->container == NodeHandle{container.id, container.generation}) {
            const auto key = std::find(policy.keys.begin(), policy.keys.end(), pendingLazyFocus_->key);
            if (key != policy.keys.end()) currentIndex = static_cast<int>(key - policy.keys.begin());
        }
        int index = currentIndex + (previous ? -1 : 1);
        const auto sequential = direction == FocusDirection::Next || direction == FocusDirection::Previous;
        if (!sequential) {
            const auto mainDirection = policy.horizontal ? direction == FocusDirection::Left || direction == FocusDirection::Right : direction == FocusDirection::Up || direction == FocusDirection::Down;
            if (!policy.grid && !mainDirection) return false;
            if (policy.grid && container.lazy && currentIndex >= 0 && currentIndex < static_cast<int>(container.lazy->itemLines.size())) {
                const auto& state = *container.lazy;
                const auto line = state.itemLines[currentIndex] + (mainDirection ? (previous ? -1 : 1) : 0);
                const auto slot = state.itemSlots[currentIndex];
                if (line < 0 || line >= static_cast<int>(state.lines.size())) return false;
                int best = -1;
                int score = std::numeric_limits<int>::max();
                for (const auto candidate : state.lines[line]) {
                    if (candidate == currentIndex) continue;
                    const auto delta = state.itemSlots[candidate] - slot;
                    if (!mainDirection && (previous ? delta >= 0 : delta <= 0)) continue;
                    if (std::abs(delta) < score) {
                        score = std::abs(delta);
                        best = candidate;
                    }
                }
                if (best < 0) return false;
                index = best;
            }
        }
        if (index < 0 || index >= static_cast<int>(policy.keys.size())) return false;
        pendingLazyFocus_ = LazyFocusRequest{{container.id, container.generation}, policy.keys[index], direction, ++lazyFocusVersion_};
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(container.id, DirtyFlag::Layout);
        return true;
    }

    void InputSession::prepareLazyInteraction(LayoutTree& tree) const {
        std::unordered_map<NodeId, std::vector<std::string>> pins;
        for (const auto node : {focusedNode(), pointer_.capturedNode(tree)}) {
            if (!node || !nodeInteractionEnabled(tree, *node)) continue;
            if (node == focusedNode() && focus_.target() && focus_.target()->node.generation != tree.node(*node).generation) continue;
            auto child = *node;
            while (const auto location = lazyItem(tree, child)) {
                const auto& policy = std::get<LazyMeasurePolicy>(tree.node(location->container).measurePolicy);
                if (location->index >= 0 && location->index < static_cast<int>(policy.keys.size())) pins[location->container].push_back(policy.keys[location->index]);
                child = location->container;
            }
        }
        for (const auto id : tree.nodeIds()) {
            const auto& node = tree.node(id);
            if (!std::holds_alternative<LazyMeasurePolicy>(node.measurePolicy)) continue;
            auto selected = pins[id];
            std::sort(selected.begin(), selected.end());
            selected.erase(std::unique(selected.begin(), selected.end()), selected.end());
            const auto request = pendingLazyFocus_ && pendingLazyFocus_->container == NodeHandle{id, node.generation};
            const auto key = request ? pendingLazyFocus_->key : std::string{};
            const auto version = request ? pendingLazyFocus_->version : node.lazy ? node.lazy->focusRequestVersion : 0;
            if (node.lazy && node.lazy->pinnedKeys == selected && node.lazy->focusRequestKey == key && node.lazy->focusRequestVersion == version) continue;
            if (selected.empty() && !request && !node.lazy) continue;
            auto& target = tree.mutableNode(id);
            target.lazy = node.lazy ? std::make_shared<LazyLayoutState>(*node.lazy) : std::make_shared<LazyLayoutState>();
            target.lazy->pinnedKeys = std::move(selected);
            target.lazy->focusRequestKey = key;
            target.lazy->focusRequestVersion = version;
            tree.markInputDirty(id, dirtyMask(DirtyFlag::Layout));
        }
    }

    void InputSession::resolveLazyFocus(const LayoutTree& tree) {
        if (!pendingLazyFocus_) return;
        const auto request = *pendingLazyFocus_;
        if (!tree.contains(request.container.id) || tree.node(request.container.id).generation != request.container.generation) {
            pendingLazyFocus_.reset();
            return;
        }
        const auto& node = tree.node(request.container.id);
        const auto* policy = std::get_if<LazyMeasurePolicy>(&node.measurePolicy);
        if (!policy) {
            pendingLazyFocus_.reset();
            return;
        }
        const auto key = std::find(policy->keys.begin(), policy->keys.end(), request.key);
        if (key == policy->keys.end()) {
            pendingLazyFocus_.reset();
            return;
        }
        const auto index = static_cast<int>(key - policy->keys.begin());
        const auto found = std::find(policy->indices.begin(), policy->indices.end(), index);
        const auto position = static_cast<std::size_t>(found - policy->indices.begin());
        if (found == policy->indices.end() || position >= node.children.size()) return;
        const auto wrapper = node.children[position];
        std::optional<FocusTarget> selected;
        for (const auto& target : focus_.snapshot())
            if (descendant(tree, target.node.id, wrapper)) {
                selected = target;
                if (!backwards(request.direction)) break;
            }
        if (selected) {
            (void)focus_.set(selected);
            pendingLazyFocus_.reset();
            return;
        }
        const auto next = index + (backwards(request.direction) ? -1 : 1);
        if (next < 0 || next >= static_cast<int>(policy->keys.size())) {
            pendingLazyFocus_.reset();
            return;
        }
        pendingLazyFocus_->key = policy->keys[next];
        pendingLazyFocus_->version = ++lazyFocusVersion_;
    }

    void InputSession::synchronizePublishedInput(const LayoutTree& tree, bool runtimeReady, TextInputBridge& text) {
        pointer_.synchronizePublishedWheel(tree, runtimeReady);
        PointerGestureOutput ignored;
        if (runtimeReady)
            pointer_.gesture().revalidate(tree, ignored);
        else
            pointer_.gesture().cancel(tree, ignored);
        text.synchronizePublishedInput(tree, runtimeReady);
        focus_.synchronize(tree, runtimeReady);
    }
}
