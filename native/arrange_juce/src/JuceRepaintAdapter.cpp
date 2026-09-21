#include <arrange/juce/JuceRepaintAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE
namespace arrange::juce {
    void JuceRepaintAdapter::repaintDirty(::juce::Component& owner, const arrange::core::PublishedFrame& frame) {
        // Published DrawOps cover the full scene, including transformed overlays and previous positions.
        if (frame.plan.passivePaint) owner.repaint();
    }
}  // namespace arrange::juce
#endif
