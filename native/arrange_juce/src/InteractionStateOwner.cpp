#include <arrange/juce/InteractionStateOwner.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/ModifierGeometry.h>
#include <algorithm>
#include <limits>
#include <unordered_map>

namespace arrange::juce {
    namespace {
        bool descendant(const arrange::core::LayoutTree& tree, arrange::core::NodeId child, arrange::core::NodeId parent) {
            const auto path = arrange::core::nodePath(tree, child);
            return std::find(path.begin(), path.end(), parent) != path.end();
        }

        struct LazyItemLocation {
            arrange::core::NodeId container;
            arrange::core::NodeId wrapper;
            int index;
        };

        std::optional<LazyItemLocation> lazyItem(const arrange::core::LayoutTree& tree, arrange::core::NodeId child) {
            const auto path = arrange::core::nodePath(tree, child);
            for (std::size_t i = path.size(); i > 1; --i) {
                const auto& parent = tree.node(path[i - 2]);
                const auto* policy = std::get_if<arrange::core::LazyMeasurePolicy>(&parent.measurePolicy);
                if (!policy) continue;
                const auto found = std::find(parent.children.begin(), parent.children.end(), path[i - 1]);
                const auto position = static_cast<std::size_t>(found - parent.children.begin());
                if (found != parent.children.end() && position < policy->indices.size()) return LazyItemLocation{parent.id, *found, policy->indices[position]};
            }
            return {};
        }

        bool backwards(arrange::core::FocusDirection direction) {
            return direction == arrange::core::FocusDirection::Previous || direction == arrange::core::FocusDirection::Up || direction == arrange::core::FocusDirection::Left;
        }
    }

    InteractionStateOwner::InteractionStateOwner(arrange::core::TextLayoutService& textLayoutService) noexcept : input_(textLayoutService) {}

    void InteractionStateOwner::reset() {
        input_.reset();
        focus_.reset();
        preparedInputEvents_.clear();
        pendingLazyFocus_.reset();
        lazyFocusVersion_ = 0;
        pointer_.resetForSceneChange();
    }

    const std::optional<arrange::core::NodeId>& InteractionStateOwner::focusedNode() const noexcept {
        return focus_.focusedNode();
    }

    float InteractionStateOwner::viewportX() const noexcept {
        return input_.viewportX();
    }

    void InteractionStateOwner::pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, const TextInputCallbacks& callbacks) {
        pendingLazyFocus_.reset();
        const auto point = arrange::core::Point{x, y};
        const auto pointerResult = pointer_.pointerDown(snapshot, point, 0);
        focus_.synchronize(tree, true);
        (void)focus_.set(arrange::core::pointerFocusTarget(tree, focus_.snapshot(), pointerResult.hit.node, point));
        input_.pointerDown(tree, pointerResult.hit, x, y, callbacks);
        dispatchCommittedFocus(tree, callbacks);
    }

    bool InteractionStateOwner::pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const TextInputCallbacks& callbacks) {
        return input_.pointerDrag(tree, runtimeReady, x, y, callbacks);
    }

    InteractionPointerUpResult InteractionStateOwner::pointerUp(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y) {
        input_.cancelDrag();
        const auto result = pointer_.pointerUp(snapshot, {x, y}, 0);
        return {result.clickTriggered, result.eventSlot};
    }

    InteractionWheelResult InteractionStateOwner::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, float deltaX, float deltaY, std::uint64_t publishedRevision, float pixelsPerWheelUnit) {
        const auto result = pointer_.wheel(tree, root, {x, y}, deltaX, deltaY, publishedRevision, pixelsPerWheelUnit);
        return result;
    }

    InteractionWheelResult InteractionStateOwner::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, const WheelInput& input, std::uint64_t publishedRevision) {
        return pointer_.wheel(tree, root, {x, y}, input, publishedRevision);
    }

    bool InteractionStateOwner::isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.isTextInputActive(tree, runtimeReady);
    }

    ::juce::Range<int> InteractionStateOwner::highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.highlightedRegion(tree, runtimeReady);
    }

    bool InteractionStateOwner::setHighlightedRegion(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range, const TextInputCallbacks& callbacks) {
        return input_.setHighlightedRegion(tree, runtimeReady, range, callbacks);
    }

    bool InteractionStateOwner::setTemporaryUnderlining(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Array<::juce::Range<int>>& ranges, const TextInputCallbacks& callbacks) {
        return input_.setTemporaryUnderlining(tree, runtimeReady, ranges, callbacks);
    }

    ::juce::String InteractionStateOwner::textInRange(const arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range) const {
        return input_.textInRange(tree, runtimeReady, range);
    }

    bool InteractionStateOwner::insertTextAtCaret(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::String& textToInsert, const TextInputCallbacks& callbacks) {
        return input_.insertTextAtCaret(tree, runtimeReady, textToInsert, callbacks);
    }

    int InteractionStateOwner::caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.caretPosition(tree, runtimeReady);
    }

    int InteractionStateOwner::totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.totalNumChars(tree, runtimeReady);
    }

    int InteractionStateOwner::charIndexForPoint(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Point<int> point) const {
        return input_.charIndexForPoint(tree, runtimeReady, point);
    }

    ::juce::Rectangle<int> InteractionStateOwner::caretRectangleForCharIndex(const arrange::core::LayoutTree& tree, bool runtimeReady, int characterIndex) const {
        return input_.caretRectangleForCharIndex(tree, runtimeReady, characterIndex);
    }

    ::juce::RectangleList<int> InteractionStateOwner::textBounds(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Range<int> range) const {
        return input_.textBounds(tree, runtimeReady, range);
    }

    bool InteractionStateOwner::keyPressed(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::KeyPress& key, const TextInputCallbacks& callbacks) {
        if (!runtimeReady) return false;
        focus_.synchronize(tree, runtimeReady);
        if (key.isKeyCode(::juce::KeyPress::tabKey)) return moveFocus(tree, key.getModifiers().isShiftDown() ? arrange::core::FocusDirection::Previous : arrange::core::FocusDirection::Next, callbacks);
        if (input_.keyPressed(tree, runtimeReady, key, callbacks)) return true;
        if (callbacks.enqueueKeyIntent) callbacks.enqueueKeyIntent(focusedNode().value_or(0), "通用焦点键盘输入");
        if (focus_.target() && (key.isKeyCode(::juce::KeyPress::returnKey) || key.isKeyCode(::juce::KeyPress::spaceKey)) && focus_.target()->click.valid()) {
            if (callbacks.invokeEvent) callbacks.invokeEvent(focus_.target()->click);
            return true;
        }
        if (key.isKeyCode(::juce::KeyPress::upKey)) return moveFocus(tree, arrange::core::FocusDirection::Up, callbacks);
        if (key.isKeyCode(::juce::KeyPress::downKey)) return moveFocus(tree, arrange::core::FocusDirection::Down, callbacks);
        if (key.isKeyCode(::juce::KeyPress::leftKey)) return moveFocus(tree, arrange::core::FocusDirection::Left, callbacks);
        if (key.isKeyCode(::juce::KeyPress::rightKey)) return moveFocus(tree, arrange::core::FocusDirection::Right, callbacks);
        if (focusedNode()) {
            const auto operation = key.isKeyCode(::juce::KeyPress::pageUpKey) ? -1 : key.isKeyCode(::juce::KeyPress::pageDownKey) ? 1 : key.isKeyCode(::juce::KeyPress::homeKey) ? -2 : key.isKeyCode(::juce::KeyPress::endKey) ? 2 : 0;
            if (operation)
                if (auto scroll = arrange::core::focusKeyboardScroll(tree, *focusedNode(), operation)) {
                    if (scroll->second.consumed && callbacks.invokeScrollEvent) callbacks.invokeScrollEvent(scroll->first, scroll->second);
                    return true;
                }
        }
        return false;
    }

    void InteractionStateOwner::synchronizePublishedFocus(const arrange::core::LayoutTree& tree, bool runtimeReady, const std::vector<arrange::core::FocusCommand>& commands) {
        if (!runtimeReady || std::any_of(commands.begin(), commands.end(), [](const auto& command) { return command.kind != arrange::core::FocusCommandKind::Cancel; })) pendingLazyFocus_.reset();
        focus_.synchronize(tree, runtimeReady, commands);
        resolveLazyFocus(tree);
        TextInputCallbacks deferred;
        deferred.invokeStringEvent = [this](const auto& slot, const auto& value) {
            preparedInputEvents_.emplace_back(slot, value);
        };
        if (focus_.target() && focus_.target()->editable)
            input_.focus(tree, focus_.target()->node.id, focus_.target()->modifier, deferred);
        else
            input_.finishFocusedInput(tree, false, deferred);
    }

    void InteractionStateOwner::dispatchCommittedFocus(arrange::core::LayoutTree& tree, const TextInputCallbacks& callbacks) {
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
                if (node.lazy && (!node.lazy->pinnedKeys.empty() || !node.lazy->focusRequestKey.empty()) || focusedNode() && std::holds_alternative<arrange::core::LazyMeasurePolicy>(node.measurePolicy) && descendant(tree, *focusedNode(), id)) callbacks.invalidateNativeState(id, arrange::core::DirtyFlag::Layout, "Lazy 焦点 pin 更新");
            }
        }
        if (focus_.takeScrollRequest() && focus_.target()) {
            if (focusChangedHook_) focusChangedHook_(focusedNode());
            for (const auto& [slot, scroll] : arrange::core::focusScrollIntoView(tree, *focus_.target()))
                if (callbacks.invokeScrollEvent) callbacks.invokeScrollEvent(slot, scroll);
        }
        for (const auto direction : focus_.takeMoves()) (void)moveFocus(tree, direction, callbacks);
    }

    bool InteractionStateOwner::requestFocus(arrange::core::LayoutTree& tree, arrange::core::NodeId node, const TextInputCallbacks& callbacks) {
        pendingLazyFocus_.reset();
        focus_.synchronize(tree, true);
        for (const auto& target : focus_.snapshot())
            if (target.node.id == node) {
                const auto changed = focus_.set(target);
                if (target.editable)
                    input_.focus(tree, node, target.modifier, callbacks);
                else
                    input_.finishFocusedInput(tree, false, callbacks);
                if (changed && callbacks.invalidateNativeState) callbacks.invalidateNativeState(node, arrange::core::DirtyFlag::Paint, "焦点改变");
                dispatchCommittedFocus(tree, callbacks);
                return true;
            }
        return false;
    }

    bool InteractionStateOwner::moveFocus(arrange::core::LayoutTree& tree, arrange::core::FocusDirection direction, const TextInputCallbacks& callbacks) {
        focus_.synchronize(tree, true);
        if (focus_.target() && focus_.target()->directions[static_cast<std::size_t>(direction)]) {
            const auto target = arrange::core::findFocusRequester(focus_.snapshot(), focus_.target()->directions[static_cast<std::size_t>(direction)]);
            return target && requestFocus(tree, target->node.id, callbacks);
        }
        if (navigateLazy(tree, direction, callbacks)) return true;
        if (focusedNode() && navigationHook_ && navigationHook_(*focusedNode(), direction)) return true;
        const auto target = arrange::core::searchFocus(focus_.snapshot(), focus_.target(), direction);
        return target && requestFocus(tree, target->node.id, callbacks);
    }

    void InteractionStateOwner::clearFocus(arrange::core::LayoutTree& tree, const TextInputCallbacks& callbacks) {
        pendingLazyFocus_.reset();
        const auto previous = focusedNode();
        (void)focus_.set({});
        input_.finishFocusedInput(tree, false, callbacks);
        if (previous && callbacks.invalidateNativeState) callbacks.invalidateNativeState(*previous, arrange::core::DirtyFlag::Paint, "焦点清空");
        dispatchCommittedFocus(tree, callbacks);
        if (focusChangedHook_) focusChangedHook_({});
    }

    bool InteractionStateOwner::navigateLazy(arrange::core::LayoutTree& tree, arrange::core::FocusDirection direction, const TextInputCallbacks& callbacks) {
        if (!focusedNode()) return false;
        const auto location = lazyItem(tree, *focusedNode());
        if (!location) return false;
        const auto& container = tree.node(location->container);
        const auto& policy = std::get<arrange::core::LazyMeasurePolicy>(container.measurePolicy);
        if (!pendingLazyFocus_)
            if (const auto candidate = arrange::core::searchFocus(focus_.snapshot(), focus_.target(), direction); candidate && descendant(tree, candidate->node.id, location->wrapper)) return false;
        const auto previous = backwards(direction);
        auto currentIndex = location->index;
        if (pendingLazyFocus_ && pendingLazyFocus_->container == arrange::core::NodeHandle{container.id, container.generation}) {
            const auto key = std::find(policy.keys.begin(), policy.keys.end(), pendingLazyFocus_->key);
            if (key != policy.keys.end()) currentIndex = static_cast<int>(key - policy.keys.begin());
        }
        int index = currentIndex + (previous ? -1 : 1);
        const auto sequential = direction == arrange::core::FocusDirection::Next || direction == arrange::core::FocusDirection::Previous;
        if (!sequential) {
            const auto mainDirection = policy.horizontal ? direction == arrange::core::FocusDirection::Left || direction == arrange::core::FocusDirection::Right : direction == arrange::core::FocusDirection::Up || direction == arrange::core::FocusDirection::Down;
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
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(container.id, arrange::core::DirtyFlag::Layout, "Lazy 方向焦点材料化");
        return true;
    }

    void InteractionStateOwner::prepareLazyInteraction(arrange::core::LayoutTree& tree) const {
        std::unordered_map<arrange::core::NodeId, std::vector<std::string>> pins;
        for (const auto node : {focusedNode(), pointer_.capturedNode(tree)}) {
            if (!node || !arrange::core::nodeInteractionEnabled(tree, *node)) continue;
            if (node == focusedNode() && focus_.target() && focus_.target()->node.generation != tree.node(*node).generation) continue;
            auto child = *node;
            while (const auto location = lazyItem(tree, child)) {
                const auto& policy = std::get<arrange::core::LazyMeasurePolicy>(tree.node(location->container).measurePolicy);
                if (location->index >= 0 && location->index < static_cast<int>(policy.keys.size())) pins[location->container].push_back(policy.keys[location->index]);
                child = location->container;
            }
        }
        for (const auto id : tree.nodeIds()) {
            auto& node = tree.node(id);
            if (!std::holds_alternative<arrange::core::LazyMeasurePolicy>(node.measurePolicy)) continue;
            auto selected = pins[id];
            std::sort(selected.begin(), selected.end());
            selected.erase(std::unique(selected.begin(), selected.end()), selected.end());
            const auto request = pendingLazyFocus_ && pendingLazyFocus_->container == arrange::core::NodeHandle{id, node.generation};
            const auto key = request ? pendingLazyFocus_->key : std::string{};
            const auto version = request ? pendingLazyFocus_->version : node.lazy ? node.lazy->focusRequestVersion : 0;
            if (node.lazy && node.lazy->pinnedKeys == selected && node.lazy->focusRequestKey == key && node.lazy->focusRequestVersion == version) continue;
            if (selected.empty() && !request && !node.lazy) continue;
            node.lazy = node.lazy ? std::make_shared<arrange::core::LazyLayoutState>(*node.lazy) : std::make_shared<arrange::core::LazyLayoutState>();
            node.lazy->pinnedKeys = std::move(selected);
            node.lazy->focusRequestKey = key;
            node.lazy->focusRequestVersion = version;
            tree.markInputDirty(id, static_cast<std::uint32_t>(arrange::core::DirtyFlag::Layout));
        }
    }

    void InteractionStateOwner::resolveLazyFocus(const arrange::core::LayoutTree& tree) {
        if (!pendingLazyFocus_) return;
        const auto request = *pendingLazyFocus_;
        if (!tree.contains(request.container.id) || tree.node(request.container.id).generation != request.container.generation) {
            pendingLazyFocus_.reset();
            return;
        }
        const auto& node = tree.node(request.container.id);
        const auto* policy = std::get_if<arrange::core::LazyMeasurePolicy>(&node.measurePolicy);
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
        std::optional<arrange::core::FocusTarget> selected;
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

    void InteractionStateOwner::updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady) {
        input_.updateFocusedInputViewport(tree, runtimeReady);
    }

    std::vector<arrange::core::DrawOp> InteractionStateOwner::buildFocusedInputOps(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.buildFocusedInputOps(tree, runtimeReady);
    }
}

#endif
