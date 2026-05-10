#include <arrange/juce/JuceRepaintAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>

#include <cmath>

namespace arrange::juce {
    void JuceRepaintAdapter::repaintDirty(
        ::juce::Component& owner,
        const ArrangeRuntime& runtime,
        const DiagnosticsState& diagnostics,
        arrange::core::NodeId root,
        bool loaded,
        bool fullIfNoBounds) {
        const auto& frame = runtime.publishedFrame();
        if (frame.plan.fullFallback || frame.plan.buildDiagnostics || diagnostics.hasError()) {
            owner.repaint();
            return;
        }

        if (frame.changes.diagnosticsDrawOpsChanged) {
            if (!frame.changes.hasDiagnosticsRepaintBounds) {
                if (fullIfNoBounds) {
                    owner.repaint();
                }
                return;
            }

            const auto left = static_cast<int>(std::floor(frame.changes.diagnosticsRepaintBounds.x)) - 2;
            const auto top = static_cast<int>(std::floor(frame.changes.diagnosticsRepaintBounds.y)) - 2;
            const auto right = static_cast<int>(std::ceil(frame.changes.diagnosticsRepaintBounds.x + frame.changes.diagnosticsRepaintBounds.width)) + 2;
            const auto bottom = static_cast<int>(std::ceil(frame.changes.diagnosticsRepaintBounds.y + frame.changes.diagnosticsRepaintBounds.height)) + 2;
            auto area = ::juce::Rectangle<int>::leftTopRightBottom(left, top, right, bottom);
            area = area.getIntersection(owner.getLocalBounds());
            if (!area.isEmpty()) {
                owner.repaint(area);
            } else if (fullIfNoBounds) {
                owner.repaint();
            }
            return;
        }

        if (frame.changes.overlayDrawOpsChanged) {
            if (!frame.changes.hasOverlayRepaintBounds) {
                if (fullIfNoBounds) {
                    owner.repaint();
                }
                return;
            }

            const auto left = static_cast<int>(std::floor(frame.changes.overlayRepaintBounds.x)) - 2;
            const auto top = static_cast<int>(std::floor(frame.changes.overlayRepaintBounds.y)) - 2;
            const auto right = static_cast<int>(std::ceil(frame.changes.overlayRepaintBounds.x + frame.changes.overlayRepaintBounds.width)) + 2;
            const auto bottom = static_cast<int>(std::ceil(frame.changes.overlayRepaintBounds.y + frame.changes.overlayRepaintBounds.height)) + 2;
            auto area = ::juce::Rectangle<int>::leftTopRightBottom(left, top, right, bottom);
            area = area.getIntersection(owner.getLocalBounds());
            if (!area.isEmpty()) {
                owner.repaint(area);
            } else if (fullIfNoBounds) {
                owner.repaint();
            }
            return;
        }

        if (!frame.plan.passivePaint) {
            return;
        }

        if (!loaded || !runtime.scene().contains(root)) {
            if (fullIfNoBounds) {
                owner.repaint();
            }
            return;
        }

        const auto& snapshot = frame.dirty;
        if (!snapshot.hasRepaintBounds) {
            if (fullIfNoBounds) {
                owner.repaint();
            }
            return;
        }

        const auto left = static_cast<int>(std::floor(snapshot.repaintBounds.x)) - 2;
        const auto top = static_cast<int>(std::floor(snapshot.repaintBounds.y)) - 2;
        const auto right = static_cast<int>(std::ceil(snapshot.repaintBounds.x + snapshot.repaintBounds.width)) + 2;
        const auto bottom = static_cast<int>(std::ceil(snapshot.repaintBounds.y + snapshot.repaintBounds.height)) + 2;

        auto area = ::juce::Rectangle<int>::leftTopRightBottom(left, top, right, bottom);
        area = area.getIntersection(owner.getLocalBounds());
        if (!area.isEmpty()) {
            owner.repaint(area);
        } else if (fullIfNoBounds) {
            owner.repaint();
        }
    }
} // namespace arrange::juce

#endif
