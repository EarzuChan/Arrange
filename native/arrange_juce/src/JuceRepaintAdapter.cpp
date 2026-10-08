#include <arrange/juce/JuceRepaintAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE
namespace arrange::juce {
    void JuceRepaintAdapter::repaintDirty(::juce::Component& owner, const arrange::core::PublishedFrame& frame) {
        // 已发布的 DrawOps 覆盖整个场景，包括变换后的覆盖层与先前位置
        if (frame.plan.passivePaint) owner.repaint();
    }
}
#endif
