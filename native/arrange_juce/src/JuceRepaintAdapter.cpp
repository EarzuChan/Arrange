#include <arrange/juce/JuceRepaintAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE
namespace arrange::juce {
    void JuceRepaintAdapter::repaintDirty(::juce::Component& owner, const arrange::core::PublishedFrame& frame) {
        // 重绘范围由发布帧决定，这里只翻译为 JUCE 请求；JUCE 在下次 paint 前合并多次请求，重放按 clip 剔除片段
        if (!frame.plan.passivePaint) return;
        const auto& region = frame.changes.repaint;
        if (region.full) {
            owner.repaint();
            return;
        }
        for (const auto& rect : region.rects) owner.repaint(::juce::Rectangle<float>(rect.x, rect.y, rect.width, rect.height).getSmallestIntegerContainer());
    }
}
#endif
