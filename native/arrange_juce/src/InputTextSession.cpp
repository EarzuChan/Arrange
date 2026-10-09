#include <arrange/juce/InputTextSession.h>

#if ARRANGE_JUCE_WITH_JUCE

namespace arrange::juce {
    void InputTextSession::reset() {
        focusedNode_.reset();
        dragAnchor_.reset();
        state_.reset();
        viewportX_ = 0.0f;
        viewportY_ = 0.0f;
        preferredX_.reset();
        pendingPlatformEdit_ = false;
        compositionCancelled_ = false;
        temporaryUnderlines_.clear();
    }
}

#endif
