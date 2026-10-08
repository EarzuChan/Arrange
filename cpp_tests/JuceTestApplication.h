#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace arrange::test {
    template <int (*Run)()>
    class JuceTestApplication final : public ::juce::JUCEApplication {
       public:
        const ::juce::String getApplicationName() override {
            return "Arrange Native Test";
        }

        const ::juce::String getApplicationVersion() override {
            return "1";
        }

        void initialise(const ::juce::String&) override {
            setApplicationReturnValue(Run());
            if (!::juce::MessageManager::getInstance()->hasStopMessageBeenSent()) quit();
        }

        void shutdown() override {}
    };
}
