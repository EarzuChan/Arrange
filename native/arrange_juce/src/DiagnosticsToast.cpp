#include <arrange/juce/DiagnosticsToast.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/DiagnosticsState.h>

namespace arrange::juce {
    bool DiagnosticsToast::show(DiagnosticsState& state, arrange::LogLevel level, std::string_view tag, std::string title, std::string content, bool coalesce) {
        const auto visible = state.addToast(level, title, content, ::juce::Time::getMillisecondCounterHiRes(), coalesce);
        const auto message = (visible ? std::string("气泡之《") : std::string("气泡已关闭，本为《")) + title + "》：" + content;
        arrange::Log::write(level, tag, message);
        return visible;
    }
}  // namespace arrange::juce

#endif
