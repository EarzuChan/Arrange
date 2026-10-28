#include <arrange/core/PointerGesture.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <cmath>

namespace arrange::core {
    namespace {
        bool sameTarget(const HitTestResult& a, const HitTestResult& b) {
            return a.node == b.node && a.generation == b.generation && a.modifier == b.modifier;
        }

        std::optional<HitTestResult> first(const std::vector<HitTestResult>& chain, InputModifierKind kind) {
            for (const auto& item : chain)
                if (item.input == kind) return item;
            return {};
        }

        void emit(PointerGestureOutput& out, const EventSlotId& slot, InputEventPayload payload) {
            if (slot.valid()) out.events.push_back({slot, std::move(payload)});
        }
    }

    const InputModifierSemantics* liveInputModifier(const LayoutTree& tree, const HitTestResult& target) {
        if (!target.node || !tree.contains(target.node)) return nullptr;
        const auto& node = tree.node(target.node);
        if (node.generation != target.generation) return nullptr;
        const auto* instance = node.modifier.find(target.modifier);
        if (!instance) return nullptr;
        const auto* input = std::get_if<InputModifierSemantics>(&instance->descriptor.value);
        return input && input->enabled && input->kind == target.input ? input : nullptr;
    }

    void PointerGestureSession::updateHover(const LayoutTree& tree, const std::vector<HitTestResult>& chain, PointerGestureOutput& out) {
        std::vector<HitTestResult> next;
        for (const auto& item : chain)
            if (item.input == InputModifierKind::Hoverable) next.push_back(item);
        for (const auto& old : hovered_) {
            if (std::any_of(next.begin(), next.end(), [&](const auto& item) { return sameTarget(item, old); })) continue;
            if (const auto* input = liveInputModifier(tree, old)) emit(out, input->exit, PointerEventPayload{});
        }
        for (const auto& item : next) {
            if (std::any_of(hovered_.begin(), hovered_.end(), [&](const auto& old) { return sameTarget(item, old); })) continue;
            if (const auto* input = liveInputModifier(tree, item)) emit(out, input->enter, PointerEventPayload{item.local.x, item.local.y, {}});
        }
        hovered_ = std::move(next);
        chain_ = chain;
        const auto icon = first(chain, InputModifierKind::PointerIcon);
        const auto* input = icon ? liveInputModifier(tree, *icon) : nullptr;
        icon_ = input ? input->icon : PointerIcon::Default;
    }

    void PointerGestureSession::updateStreams(const LayoutTree& tree, const std::vector<HitTestResult>& chain, const PointerSample& sample, PointerGestureOutput& out) {
        std::vector<HitTestResult> next;
        for (const auto& item : chain)
            if (item.input == InputModifierKind::PointerInput) next.push_back(item);
        for (const auto& old : streams_) {
            if (std::any_of(next.begin(), next.end(), [&](const auto& item) { return sameTarget(item, old); })) continue;
            if (const auto* input = liveInputModifier(tree, old)) emit(out, input->eventSlot, PointerInputPayload{PointerInputType::Exit, 0, 0, sample.modifiers});
        }
        for (const auto& item : next) {
            const auto entered = std::none_of(streams_.begin(), streams_.end(), [&](const auto& old) { return sameTarget(item, old); });
            if (const auto* input = liveInputModifier(tree, item)) emit(out, input->eventSlot, PointerInputPayload{entered ? PointerInputType::Enter : PointerInputType::Move, item.local.x, item.local.y, sample.modifiers});
        }
        streams_ = std::move(next);
    }

    void PointerGestureSession::emitPressed(const LayoutTree& tree, PointerInputType type, const PointerSample& sample, PointerGestureOutput& out) {
        if (!press_ || !press_->pointer) return;
        const auto& target = *press_->pointer;
        const auto* input = liveInputModifier(tree, target);
        if (!input) return;
        // 按下点之外的位置按受体所在层的逆变换外推，缩放与旋转下仍是受体本地坐标
        const auto start = rootToNodeContent(tree, target.node, press_->start, target.modifier);
        const auto now = rootToNodeContent(tree, target.node, sample.point, target.modifier);
        emit(out, input->eventSlot, PointerInputPayload{type, target.local.x + now.x - start.x, target.local.y + now.y - start.y, sample.modifiers});
    }

    void PointerGestureSession::syncInteractions(const LayoutTree& tree, PointerGestureOutput& out) {
        std::vector<NodeHandle> nodes;
        const auto add = [&](NodeHandle node) {
            if (std::find(nodes.begin(), nodes.end(), node) == nodes.end()) nodes.push_back(node);
        };
        for (const auto& [receptor, state] : interactions_) add(receptor.node);
        for (const auto& item : chain_) add({item.node, item.generation});
        if (press_)
            for (const auto* target : {press_->clickable ? &*press_->clickable : nullptr, press_->draggable ? &*press_->draggable : nullptr, press_->pointer ? &*press_->pointer : nullptr})
                if (target) add({target->node, target->generation});
        std::vector<std::pair<InteractionReceptor, InteractionPayload>> next;
        for (const auto node : nodes) {
            if (!tree.contains(node.id) || tree.node(node.id).generation != node.generation) continue;
            // 悬停以节点为单位；按下与拖动只归属被按下的受体
            const auto hovered = std::any_of(chain_.begin(), chain_.end(), [&](const auto& item) { return item.node == node.id && item.generation == node.generation; });
            for (const auto& instance : tree.node(node.id).modifier.elements()) {
                const auto* input = std::get_if<InputModifierSemantics>(&instance.descriptor.value);
                if (!input || !input->interaction.valid()) continue;
                const auto owns = [&](const std::optional<HitTestResult>& target) {
                    return target && target->node == node.id && target->generation == node.generation && target->modifier == instance.handle;
                };
                InteractionPayload state;
                state.hovered = hovered;
                state.pressed = press_ && (owns(press_->clickable) || owns(press_->draggable) || owns(press_->pointer));
                state.dragged = press_ && press_->dragging && owns(press_->draggable);
                const InteractionReceptor receptor{node, instance.handle};
                const auto previous = std::find_if(interactions_.begin(), interactions_.end(), [&](const auto& item) { return item.first == receptor; });
                const auto before = previous == interactions_.end() ? InteractionPayload{} : previous->second;
                if (state != before) emit(out, input->interaction, state);
                if (state != InteractionPayload{}) next.emplace_back(receptor, state);
            }
        }
        interactions_ = std::move(next);
    }

    void PointerGestureSession::move(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out) {
        // 按下期间悬停与光标冻结
        if (press_) return;
        const auto chain = hitTester_.hitChain(snapshot, sample.point);
        updateHover(tree, chain, out);
        updateStreams(tree, chain, sample, out);
        syncInteractions(tree, out);
    }

    void PointerGestureSession::exit(const LayoutTree& tree, PointerGestureOutput& out) {
        if (press_) return;
        updateHover(tree, {}, out);
        updateStreams(tree, {}, {}, out);
        syncInteractions(tree, out);
    }

    void PointerGestureSession::primaryDown(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, int clicks, PointerGestureOutput& out) {
        cancel(tree, out);
        const auto chain = hitTester_.hitChain(snapshot, sample.point);
        updateHover(tree, chain, out);
        updateStreams(tree, chain, sample, out);
        Press press;
        press.start = press.last = sample.point;
        press.lastTime = sample.timeMillis;
        press.clicks = clicks;
        if (auto clickable = first(chain, InputModifierKind::Clickable); clickable && liveInputModifier(tree, *clickable)) press.clickable = clickable;
        if (auto draggable = first(chain, InputModifierKind::Draggable); draggable && liveInputModifier(tree, *draggable)) press.draggable = draggable;
        if (auto pointer = first(chain, InputModifierKind::PointerInput); pointer && liveInputModifier(tree, *pointer)) press.pointer = pointer;
        if (!press.clickable && !press.draggable && !press.pointer) {
            syncInteractions(tree, out);
            return;
        }
        press_ = press;
        out.consumed = true;
        emitPressed(tree, PointerInputType::Down, sample, out);
        if (const auto* input = press_->draggable ? liveInputModifier(tree, *press_->draggable) : nullptr; input && input->startImmediately) {
            press_->dragging = true;
            press_->locked = input->pointerLock;
            out.lockPointer = input->pointerLock;
            emit(out, input->dragStart, DragStartPayload{press_->draggable->local.x, press_->draggable->local.y, press_->draggable->bounds.width, press_->draggable->bounds.height, sample.modifiers});
        }
        syncInteractions(tree, out);
    }

    void PointerGestureSession::drag(const LayoutTree& tree, const PointerSample& sample, PointerGestureOutput& out) {
        if (!press_) return;
        out.consumed = true;
        // 低级指针流不受拖动阈值限制
        emitPressed(tree, PointerInputType::Move, sample, out);
        auto& press = *press_;
        const auto* input = press.draggable ? liveInputModifier(tree, *press.draggable) : nullptr;
        if (press.draggable && !input) {
            cancel(tree, out);
            return;
        }
        const auto axis = input ? input->axis : DragAxis::Both;
        const auto project = [&](Point delta) {
            return axis == DragAxis::Horizontal ? Point{delta.x, 0} : axis == DragAxis::Vertical ? Point{0, delta.y} : delta;
        };
        auto delta = project({sample.point.x - press.last.x, sample.point.y - press.last.y});
        if (!press.moved) {
            const auto total = project({sample.point.x - press.start.x, sample.point.y - press.start.y});
            const auto distance = std::hypot(total.x, total.y);
            if (distance <= touchSlop_) {
                // 阈值内：已立即开始的拖动照常交付，其余只记位置
                if (!press.dragging) {
                    press.lastTime = sample.timeMillis;
                    return;
                }
            } else {
                press.moved = true;
                if (input && !press.dragging) {
                    // 越过阈值才开始的拖动，首段位移扣除阈值
                    const auto scale = (distance - touchSlop_) / distance;
                    delta = {total.x * scale, total.y * scale};
                    press.dragging = true;
                    press.locked = input->pointerLock;
                    out.lockPointer = input->pointerLock;
                    emit(out, input->dragStart, DragStartPayload{press.draggable->local.x, press.draggable->local.y, press.draggable->bounds.width, press.draggable->bounds.height, sample.modifiers});
                    syncInteractions(tree, out);
                }
            }
        }
        if (!press.dragging) {
            press.last = sample.point;
            press.lastTime = sample.timeMillis;
            return;
        }
        const auto elapsed = sample.timeMillis - press.lastTime;
        if (elapsed > 0) press.velocity = 0.6f * static_cast<float>(std::hypot(delta.x, delta.y) * 1000.0 / elapsed) + 0.4f * press.velocity;
        press.last = sample.point;
        press.lastTime = sample.timeMillis;
        if (delta.x != 0 || delta.y != 0) emit(out, input->eventSlot, DragDeltaPayload{delta.x, delta.y, sample.modifiers});
    }

    void PointerGestureSession::stopDrag(const LayoutTree& tree, bool cancelled, PointerGestureOutput& out) {
        auto& press = *press_;
        if (!press.dragging) return;
        press.dragging = false;
        if (const auto* input = press.draggable ? liveInputModifier(tree, *press.draggable) : nullptr) emit(out, input->dragStop, DragStopPayload{cancelled ? 0.0f : press.velocity, cancelled});
        if (press.locked) {
            out.unlockPointer = true;
            out.restorePoint = press.start;
            press.locked = false;
        }
    }

    void PointerGestureSession::primaryUp(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out) {
        if (!press_) return;
        out.consumed = true;
        const auto press = *press_;
        stopDrag(tree, false, out);
        emitPressed(tree, PointerInputType::Up, sample, out);
        press_.reset();
        const auto chain = hitTester_.hitChain(snapshot, sample.point);
        // 拖动越过阈值后不再识别为点击
        if (press.clickable && !(press.draggable && press.moved)) {
            const auto released = first(chain, InputModifierKind::Clickable);
            if (released && sameTarget(*released, *press.clickable))
                if (const auto* input = liveInputModifier(tree, *released)) emit(out, press.clicks >= 2 && input->doubleClick.valid() ? input->doubleClick : input->eventSlot, std::monostate{});
        }
        // 锁定指针时抬起点并非真实光标位置，悬停留待下一次移动
        if (!press.locked) {
            updateHover(tree, chain, out);
            updateStreams(tree, chain, sample, out);
        }
        syncInteractions(tree, out);
    }

    void PointerGestureSession::contextClick(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out) {
        if (press_) return;
        const auto target = first(hitTester_.hitChain(snapshot, sample.point), InputModifierKind::ContextClick);
        const auto* input = target ? liveInputModifier(tree, *target) : nullptr;
        if (!input) return;
        out.consumed = true;
        emit(out, input->eventSlot, PointerEventPayload{target->local.x, target->local.y, sample.modifiers});
    }

    void PointerGestureSession::cancel(const LayoutTree& tree, PointerGestureOutput& out) {
        if (!press_) return;
        stopDrag(tree, true, out);
        if (press_->pointer)
            if (const auto* input = liveInputModifier(tree, *press_->pointer)) emit(out, input->eventSlot, PointerInputPayload{PointerInputType::Cancel, 0, 0, {}});
        press_.reset();
        syncInteractions(tree, out);
    }

    void PointerGestureSession::revalidate(const LayoutTree& tree, PointerGestureOutput& out) {
        std::erase_if(hovered_, [&](const auto& item) { return !liveInputModifier(tree, item); });
        std::erase_if(chain_, [&](const auto& item) { return !liveInputModifier(tree, item); });
        std::erase_if(streams_, [&](const auto& item) { return !liveInputModifier(tree, item); });
        if (!press_) return;
        if (press_->draggable && !liveInputModifier(tree, *press_->draggable)) {
            cancel(tree, out);
            return;
        }
        if (press_->clickable && !liveInputModifier(tree, *press_->clickable)) press_->clickable.reset();
        if (press_->pointer && !liveInputModifier(tree, *press_->pointer)) press_->pointer.reset();
        if (!press_->clickable && !press_->draggable && !press_->pointer) press_.reset();
        syncInteractions(tree, out);
    }

    void PointerGestureSession::reset() noexcept {
        press_.reset();
        hovered_.clear();
        chain_.clear();
        streams_.clear();
        interactions_.clear();
        icon_ = PointerIcon::Default;
    }

    std::optional<NodeId> PointerGestureSession::capturedNode(const LayoutTree& tree) const {
        if (!press_) return {};
        for (const auto* target : {press_->draggable ? &*press_->draggable : nullptr, press_->clickable ? &*press_->clickable : nullptr, press_->pointer ? &*press_->pointer : nullptr})
            if (target && liveInputModifier(tree, *target)) return target->node;
        return {};
    }
}
