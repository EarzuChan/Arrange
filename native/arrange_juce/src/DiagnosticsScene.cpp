#include <arrange/juce/DiagnosticsScene.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <cmath>

namespace arrange::juce {
    namespace {
        std::uint32_t accentColour(LogLevel level) noexcept {
            switch (level) {
            case LogLevel::Trace:
            case LogLevel::Debug:
                return 0xff94a3b8u;
            case LogLevel::Info:
                return 0xff3b82f6u;
            case LogLevel::Warn:
                return 0xfff59e0bu;
            case LogLevel::Error:
                return 0xffef4444u;
            }
            return 0xff3b82f6u;
        }
    } // namespace

    std::vector<arrange::core::DrawOp> DiagnosticsScene::buildErrorScreen(
        ::juce::Rectangle<int> editorBounds,
        const ErrorScreenModel& error,
        bool detailed) const {
        std::vector<arrange::core::DrawOp> ops;
        auto area = rect(editorBounds.reduced(20));
        ops.push_back(fill(area, detailed ? 0xff2a1014u : 0xff111827u, 10.0f));
        if (detailed) {
            const auto titleArea = arrange::core::Rect{area.x, area.y, area.width, 34.0f};
            ops.push_back(text(titleArea, error.title.empty() ? "Arrange Error" : error.title, 0xffff6b6bu, 18.0f));
            area.y += 34.0f;
            area.height = std::max(0.0f, area.height - 34.0f);
            auto body = error.diagnosticText();
            if (error.retryAvailable) body += "\nClick anywhere to retry.";
            ops.push_back(text(area, std::move(body), 0xe0ffffffu, 13.0f, 8));
            return ops;
        }

        const auto titleArea = arrange::core::Rect{area.x, area.y, area.width, 32.0f};
        ops.push_back(text(titleArea, "Arrange error screen hidden", 0xfff59e0bu, 17.0f));
        area.y += 32.0f;
        area.height = std::max(0.0f, area.height - 32.0f);
        ops.push_back(text(area, error.summary + "\nError details are still available in logs and Cmd/Ctrl+C diagnostics.", 0xc7ffffffu, 13.0f, 4));
        return ops;
    }

    std::vector<arrange::core::DrawOp> DiagnosticsScene::buildBadge(
        ::juce::Rectangle<int> editorBounds,
        const DiagnosticsBadgeModel& model,
        DiagnosticVisibility visibility) const {
        std::vector<arrange::core::DrawOp> ops;
        if (!DiagnosticsOverlay::visibilityEnabled(visibility) || model.text.empty()) return ops;

        const auto textWidth = static_cast<int>(model.text.size()) * 7 + 26;
        const auto x = static_cast<int>(std::round(std::max(
            static_cast<float>(editorBounds.getX() + 8),
            static_cast<float>(editorBounds.getRight() - 8 - textWidth))));
        const auto y = editorBounds.getY() + 20;
        const arrange::core::Rect badge{static_cast<float>(x), static_cast<float>(y), static_cast<float>(textWidth), 20.0f};
        ops.push_back(fill(badge, 0xcc111827u, 6.0f));
        ops.push_back(stroke(badge, 0x664b5563u, 1.0f, 6.0f));
        ops.push_back(fill({badge.x + 8.0f, badge.y + 7.0f, 6.0f, 6.0f}, static_cast<std::uint32_t>(model.dot.getARGB()), 3.0f));
        ops.push_back(text({badge.x + 20.0f, badge.y + 1.0f, badge.width - 20.0f, badge.height - 2.0f}, model.text, 0xffe8eaedu, 11.0f));
        return ops;
    }

    std::vector<arrange::core::DrawOp> DiagnosticsScene::buildToasts(
        ::juce::Rectangle<int> editorBounds,
        const std::vector<DiagnosticsToastModel>& toasts,
        DiagnosticVisibility visibility) const {
        std::vector<arrange::core::DrawOp> ops;
        if (!DiagnosticsOverlay::visibilityEnabled(visibility) || toasts.empty()) return ops;

        const auto maxToastWidth = std::min(360, std::max(220, editorBounds.getWidth() - 32));
        auto y = editorBounds.getY() + 48;
        auto drawn = 0;
        for (auto it = toasts.rbegin(); it != toasts.rend() && drawn < 3; ++it, ++drawn) {
            const auto titleWidth = static_cast<int>(it->title.size()) * 8;
            const auto messageWidth = static_cast<int>(it->message.size()) * 7;
            const auto width = std::min(maxToastWidth, std::max(180, std::max(titleWidth, messageWidth) + 28));
            const auto height = it->message.empty() ? 30 : 48;
            const auto x = static_cast<int>(std::round(std::max(
                static_cast<float>(editorBounds.getX() + 12),
                static_cast<float>(editorBounds.getRight() - width - 12))));
            const arrange::core::Rect toast{static_cast<float>(x), static_cast<float>(y), static_cast<float>(width), static_cast<float>(height)};
            ops.push_back(fill(toast, 0xe6111827u, 8.0f));
            ops.push_back(stroke(toast, accentColour(it->level), 1.0f, 8.0f));
            ops.push_back(fill({toast.x, toast.y, 4.0f, toast.height}, accentColour(it->level), 4.0f));
            ops.push_back(text({toast.x + 12.0f, toast.y + 6.0f, toast.width - 24.0f, 15.0f}, it->title, 0xfff8fafcu, 12.0f));
            if (!it->message.empty()) {
                ops.push_back(text({toast.x + 12.0f, toast.y + 23.0f, toast.width - 24.0f, toast.height - 29.0f}, it->message, 0xffcbd5e1u, 11.0f));
            }
            y += height + 8;
        }
        return ops;
    }

    arrange::core::Rect DiagnosticsScene::rect(::juce::Rectangle<int> value) noexcept {
        return {
            static_cast<float>(value.getX()),
            static_cast<float>(value.getY()),
            static_cast<float>(value.getWidth()),
            static_cast<float>(value.getHeight()),
        };
    }

    arrange::core::DrawOp DiagnosticsScene::fill(arrange::core::Rect rect, std::uint32_t color, float radius) {
        arrange::core::DrawOp op;
        op.type = arrange::core::DrawOpType::FillRect;
        op.rect = rect;
        op.color = color;
        op.shape = radius > 0.0f ? arrange::core::DrawShapeType::Rounded : arrange::core::DrawShapeType::Rectangle;
        op.cornerRadius = radius;
        return op;
    }

    arrange::core::DrawOp DiagnosticsScene::stroke(arrange::core::Rect rect, std::uint32_t color, float width, float radius) {
        arrange::core::DrawOp op;
        op.type = arrange::core::DrawOpType::StrokeRect;
        op.rect = rect;
        op.color = color;
        op.strokeWidth = width;
        op.shape = radius > 0.0f ? arrange::core::DrawShapeType::Rounded : arrange::core::DrawShapeType::Rectangle;
        op.cornerRadius = radius;
        return op;
    }

    arrange::core::DrawOp DiagnosticsScene::text(arrange::core::Rect rect, std::string value, std::uint32_t color, float fontSize, int maxLines) {
        arrange::core::DrawOp op;
        op.type = arrange::core::DrawOpType::DrawText;
        op.rect = rect;
        op.color = color;
        op.fontSize = fontSize;
        op.lineHeight = fontSize * 1.2f;
        op.maxLines = maxLines;
        op.text = std::move(value);
        return op;
    }
} // namespace arrange::juce

#endif
