#pragma once

#include <arrange/juce/TextInputOwner.h>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;

    class TextInputMutationSink final {
    public:
        [[nodiscard]] TextInputCallbacks callbacks(ArrangeRuntime& runtime) const;
    };

#endif
} // namespace arrange::juce

