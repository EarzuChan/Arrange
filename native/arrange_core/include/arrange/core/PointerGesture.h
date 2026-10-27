#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "HitTest.h"
#include "InputEvent.h"
#include "LayoutTree.h"
#include "Modifier.h"
#include "SlotUpdate.h"

#include <optional>
#include <vector>

namespace arrange::core {
    struct PointerSample {
        // 编辑器逻辑 PX，浮点
        Point point;
        KeyModifierState modifiers;
        double timeMillis = 0;
    };

    struct PointerGestureEvent {
        EventSlotId slot;
        // monostate 表示无参回调（onClick）
        InputEventPayload payload;
    };

    struct PointerGestureOutput {
        std::vector<PointerGestureEvent> events;
        // 拖动开始要求无界移动；拖动结束要求解除并把光标放回按下点
        bool lockPointer = false;
        bool unlockPointer = false;
        Point restorePoint;
        bool consumed = false;
    };

    // 待编辑器执行的指针平台效果：无界移动的开启与解除
    struct PointerPlatformEffects {
        bool lockPointer = false;
        bool unlockPointer = false;
        Point restorePoint;
    };

    // 原生指针会话：主键按下、点击与双击、拖动阈值与独占、上下文点击、悬停与光标
    class PointerGestureSession {
       public:
        void setTouchSlop(float px) noexcept {
            touchSlop_ = px;
        }

        void move(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out);
        void exit(const LayoutTree& tree, PointerGestureOutput& out);
        void primaryDown(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, int clicks, PointerGestureOutput& out);
        void drag(const LayoutTree& tree, const PointerSample& sample, PointerGestureOutput& out);
        void primaryUp(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out);
        void contextClick(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out);
        // 丢失捕获、失焦、隐藏、热更新与关闭；拖动中会以 cancelled 停止
        void cancel(const LayoutTree& tree, PointerGestureOutput& out);
        // 场景发布后核对按下与拖动目标，退休或被替换即取消
        void revalidate(const LayoutTree& tree, PointerGestureOutput& out);
        void reset() noexcept;

        [[nodiscard]] bool pressed() const noexcept {
            return press_.has_value();
        }

        [[nodiscard]] bool dragging() const noexcept {
            return press_ && press_->dragging;
        }

        [[nodiscard]] std::optional<NodeId> capturedNode(const LayoutTree& tree) const;

        [[nodiscard]] PointerIcon icon() const noexcept {
            return icon_;
        }

       private:
        struct Press {
            Point start;
            Point last;
            double lastTime = 0;
            int clicks = 1;
            std::optional<HitTestResult> clickable;
            std::optional<HitTestResult> draggable;
            bool moved = false;
            bool dragging = false;
            bool locked = false;
            float velocity = 0;
        };

        void updateHover(const LayoutTree& tree, const std::vector<HitTestResult>& chain, PointerGestureOutput& out);
        // 按节点汇总悬停、按下与拖动中，变化时交付给该节点全部 interaction 槽
        void syncInteractions(const LayoutTree& tree, PointerGestureOutput& out);
        void stopDrag(const LayoutTree& tree, bool cancelled, PointerGestureOutput& out);

        std::optional<Press> press_;
        std::vector<HitTestResult> hovered_;
        std::vector<HitTestResult> chain_;
        std::vector<std::pair<NodeHandle, InteractionPayload>> interactions_;
        PointerIcon icon_ = PointerIcon::Default;
        float touchSlop_ = 4.0f;
        HitTester hitTester_;
    };

    // 取命中结果对应的现存输入 Modifier；节点退休、代次或实例变化时为空
    const InputModifierSemantics* liveInputModifier(const LayoutTree& tree, const HitTestResult& target);
}
