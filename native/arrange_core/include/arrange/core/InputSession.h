#pragma once

#include "EventSlot.h"
#include "FocusOwner.h"
#include "InputEvent.h"
#include "LayoutTree.h"
#include "PointerInputState.h"
#include "Scroll.h"

#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace arrange::core {
    // 平台无关的按键：key 沿用 Web KeyboardEvent.key 写法；code 只用于配对同一物理键的按下与抬起
    struct KeyInput {
        int code = 0;
        std::string key;
        std::string text;
        KeyModifierState modifiers;
    };

    struct PointerDownOptions {
        int clickCount = 1;
        bool extendSelection = false;
    };

    // 输入会话向运行时交付的出口；未设置的出口视为不消费
    struct InputCallbacks {
        std::function<void(const EventSlotId&, const std::string&)> invokeStringEvent;
        std::function<void(NodeId, DirtyFlag)> invalidateNativeState;
        std::function<void(NodeId)> enqueueKeyIntent;
        std::function<void(NodeId)> enqueueTextInputIntent;
        std::function<void(NodeId)> enqueueImeCompositionIntent;
        std::function<void(const EventSlotId&, bool, bool)> invokeFocusEvent;
        std::function<void(const EventSlotId&)> invokeEvent;
        std::function<void(const EventSlotId&, const ScrollResult&)> invokeScrollEvent;
        // 同步调用 onKeyEvent，返回是否消费
        std::function<bool(const EventSlotId&, const KeyEventPayload&)> dispatchKeyEvent;
        std::function<std::string()> readClipboard;
        std::function<void(const std::string&)> writeClipboard;
    };

    // 文本编辑由平台层持有；会话只在焦点、指针与按键的固定时点调用它。默认实现不编辑任何文本
    class TextInputBridge {
       public:
        virtual ~TextInputBridge() = default;

        virtual void focus(const LayoutTree&, NodeId, ModifierHandle, const InputCallbacks&) {}

        virtual void finishFocusedInput(const LayoutTree&, bool, const InputCallbacks&) {}

        virtual void pointerDown(LayoutTree&, const HitTestResult&, float, float, const InputCallbacks&, PointerDownOptions) {}

        virtual bool pointerDrag(LayoutTree&, bool, float, float, const InputCallbacks&) {
            return false;
        }

        virtual void cancelDrag() noexcept {}

        virtual bool keyPressed(LayoutTree&, bool, const KeyInput&, const InputCallbacks&) {
            return false;
        }

        virtual void synchronizePublishedInput(const LayoutTree&, bool) {}
    };

    struct PointerUpResult {
        bool clickTriggered = false;
        EventSlotId eventSlot;
        PointerGestureOutput gesture;
    };

    // 指针、滚轮、按键、焦点与 Lazy 焦点的唯一语义所有者；可整体复制为帧候选，成功后提交
    class InputSession {
       public:
        void reset();
        void commitState(InputSession&& candidate) noexcept;

        [[nodiscard]] const std::optional<NodeId>& focusedNode() const noexcept {
            return focus_.focusedNode();
        }

        [[nodiscard]] const FocusOwner& focus() const noexcept {
            return focus_;
        }

        void synchronizePublishedFocus(const LayoutTree& tree, bool runtimeReady, TextInputBridge& text, const std::vector<FocusCommand>& commands = {});
        void dispatchCommittedFocus(LayoutTree& tree, TextInputBridge& text, const InputCallbacks& callbacks);

        void setFocusNavigationHook(std::function<bool(NodeId, FocusDirection)> hook) {
            navigationHook_ = std::move(hook);
        }

        void setFocusChangedHook(std::function<void(std::optional<NodeId>)> hook) {
            focusChangedHook_ = std::move(hook);
        }

        bool requestFocus(LayoutTree& tree, NodeId node, TextInputBridge& text, const InputCallbacks& callbacks);
        bool moveFocus(LayoutTree& tree, FocusDirection direction, TextInputBridge& text, const InputCallbacks& callbacks);
        void clearFocus(LayoutTree& tree, TextInputBridge& text, const InputCallbacks& callbacks);
        void prepareLazyInteraction(LayoutTree& tree) const;

        [[nodiscard]] bool hasPendingLazyFocus() const noexcept {
            return pendingLazyFocus_.has_value();
        }

        [[nodiscard]] std::optional<NodeId> pendingLazyContainer() const noexcept {
            return pendingLazyFocus_ ? std::optional<NodeId>{pendingLazyFocus_->container.id} : std::nullopt;
        }

        PointerGestureOutput pointerDown(LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, TextInputBridge& text, const InputCallbacks& callbacks, PointerDownOptions options = {});
        [[nodiscard]] bool pointerDrag(LayoutTree& tree, bool runtimeReady, const PointerSample& sample, TextInputBridge& text, const InputCallbacks& callbacks, PointerGestureOutput* gesture = nullptr);
        [[nodiscard]] PointerUpResult pointerUp(LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, TextInputBridge& text);
        PointerGestureOutput pointerMove(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample);
        PointerGestureOutput pointerExit(const LayoutTree& tree);
        PointerGestureOutput contextClick(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample);
        // 统一取消：按下、文本拖选、拖动与滚轮会话
        PointerGestureOutput cancelPointer(const LayoutTree& tree, TextInputBridge& text);

        [[nodiscard]] PointerIcon pointerIcon() const noexcept {
            return pointer_.gesture().icon();
        }

        [[nodiscard]] bool pointerDragging() const noexcept {
            return pointer_.gesture().dragging();
        }

        void notePointerEffects(const PointerGestureOutput& output) noexcept;

        PointerPlatformEffects takePointerEffects() noexcept {
            return std::exchange(effects_, {});
        }

        void setTouchSlop(float px) noexcept {
            pointer_.gesture().setTouchSlop(px);
        }

        [[nodiscard]] WheelDispatchResult wheel(LayoutTree& tree, NodeId root, Point point, const WheelInput& input, std::uint64_t publishedRevision = 0, const HitTestSnapshot* snapshot = nullptr) {
            return pointer_.wheel(tree, root, point, input, publishedRevision, snapshot);
        }

        void cancelWheel() {
            pointer_.cancelWheel();
        }

        [[nodiscard]] bool keyDown(LayoutTree& tree, bool runtimeReady, const KeyInput& key, TextInputBridge& text, const InputCallbacks& callbacks);
        // 为已不在按下状态的键交付 key up；isDown 为空时视为全部抬起（失焦补发）
        [[nodiscard]] bool keyStateChanged(LayoutTree& tree, bool runtimeReady, const std::function<bool(int)>& isDown, const InputCallbacks& callbacks);
        void modifierKeysChanged(LayoutTree& tree, bool runtimeReady, KeyModifierState modifiers, const InputCallbacks& callbacks);

        void synchronizePublishedInput(const LayoutTree& tree, bool runtimeReady, TextInputBridge& text);

       private:
        struct PressedKey {
            int code = 0;
            std::string key;
            std::string text;
            // 只有交付过 key down 的键才交付 key up
            bool delivered = false;
        };

        struct KeyActivation {
            int code = 0;
            NodeId node = 0;
        };

        struct LazyFocusRequest {
            NodeHandle container;
            std::string key;
            FocusDirection direction = FocusDirection::Next;
            std::uint64_t version = 0;
        };

        bool bubbleKey(const LayoutTree& tree, const KeyEventPayload& payload, const InputCallbacks& callbacks) const;
        bool navigateLazy(LayoutTree& tree, FocusDirection direction, const InputCallbacks& callbacks);
        void resolveLazyFocus(const LayoutTree& tree);

        PointerInputState pointer_;
        PointerPlatformEffects effects_;
        FocusOwner focus_;
        std::vector<PressedKey> pressedKeys_;
        std::optional<KeyActivation> activation_;
        KeyModifierState modifiers_;
        std::vector<std::pair<EventSlotId, std::string>> preparedInputEvents_;
        std::function<bool(NodeId, FocusDirection)> navigationHook_;
        std::function<void(std::optional<NodeId>)> focusChangedHook_;
        std::optional<LazyFocusRequest> pendingLazyFocus_;
        std::uint64_t lazyFocusVersion_ = 0;
    };
}
