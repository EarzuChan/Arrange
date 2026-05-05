#include <arrange/juce/DiagnosticsOverlay.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <chrono>
#include <cmath>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <utility>

namespace arrange::juce {
    namespace {
        const char* logLevelLabel(LogLevel level) noexcept {
            switch (level) {
            case LogLevel::Trace: return "trace";
            case LogLevel::Debug: return "debug";
            case LogLevel::Info: return "info";
            case LogLevel::Warn: return "warn";
            case LogLevel::Error: return "error";
            }
            return "info";
        }

        int logLevelRank(LogLevel level) noexcept {
            switch (level) {
            case LogLevel::Trace: return 0;
            case LogLevel::Debug: return 1;
            case LogLevel::Info: return 2;
            case LogLevel::Warn: return 3;
            case LogLevel::Error: return 4;
            }
            return 2;
        }

        bool logLevelEnabled(LogLevel eventLevel, LogLevel configuredLevel) noexcept { return logLevelRank(eventLevel) >= logLevelRank(configuredLevel); }

        ::juce::Colour diagnosticAccentColour(LogLevel level) {
            switch (level) {
            case LogLevel::Trace:
            case LogLevel::Debug:
                return ::juce::Colour(0xff94a3b8);
            case LogLevel::Info:
                return ::juce::Colour(0xff3b82f6);
            case LogLevel::Warn:
                return ::juce::Colour(0xfff59e0b);
            case LogLevel::Error:
                return ::juce::Colour(0xffef4444);
            }
            return ::juce::Colour(0xff3b82f6);
        }
    } // namespace

    void DiagnosticsOverlay::configure(DiagnosticsConfig config) {
        config_ = std::move(config);
        toasts_.clear();
        events_.clear();
    }

    bool DiagnosticsOverlay::emit(LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast) {
        recordEvent(level, title, message);
        writeLog(level, title, message);
        if (!toast) return false;
        return pushToast(level, std::move(title), std::move(message), ::juce::Time::getMillisecondCounterHiRes(), coalesceToast);
    }

    bool DiagnosticsOverlay::tick(double nowMillis) {
        if (toasts_.empty()) return false;
        const auto before = toasts_.size();
        toasts_.erase(
            std::remove_if(
                toasts_.begin(),
                toasts_.end(),
                [nowMillis](const Toast& toast) { return toast.expiresAtMs <= nowMillis; }),
            toasts_.end());
        return before != toasts_.size();
    }

    bool DiagnosticsOverlay::hasActiveToasts() const noexcept { return !toasts_.empty(); }

    void DiagnosticsOverlay::paintBadge(::juce::Graphics& g, ::juce::Rectangle<int> editorBounds, const DiagnosticsBadgeModel& model) const {
        if (!visibilityEnabled(config_.badge)) return;
        if (model.text.empty()) return;

        g.setFont(::juce::FontOptions(11.0f));
        const auto textWidth = g.getCurrentFont().getStringWidth(model.text) + 26;
        const auto anchorX = static_cast<float>(editorBounds.getX());
        const auto anchorY = static_cast<float>(editorBounds.getY());
        const auto anchorWidth = static_cast<float>(editorBounds.getWidth());
        auto rect = ::juce::Rectangle<int>(textWidth, 20).withPosition(
            static_cast<int>(std::round(std::max(
                anchorX + 8.0f,
                anchorX + anchorWidth - 8.0f - static_cast<float>(textWidth)))),
            static_cast<int>(std::round(anchorY + 20.0f)));

        g.setColour(::juce::Colour(0xcc111827));
        g.fillRoundedRectangle(rect.toFloat(), 6.0f);
        g.setColour(::juce::Colour(0x664b5563));
        g.drawRoundedRectangle(rect.toFloat(), 6.0f, 1.0f);
        g.setColour(model.dot);
        g.fillEllipse(::juce::Rectangle<float>(static_cast<float>(rect.getX() + 8), static_cast<float>(rect.getCentreY() - 3), 6.0f, 6.0f));
        g.setColour(::juce::Colour(0xffe8eaed));
        g.drawText(::juce::String(model.text), rect.withTrimmedLeft(20).reduced(0, 1), ::juce::Justification::centredLeft, true);
    }

    void DiagnosticsOverlay::paintToasts(::juce::Graphics& g, ::juce::Rectangle<int> editorBounds) const {
        if (!visibilityEnabled(config_.toasts)) return;
        if (toasts_.empty()) return;

        const auto anchorX = static_cast<float>(editorBounds.getX());
        const auto anchorY = static_cast<float>(editorBounds.getY());
        const auto anchorWidth = static_cast<float>(editorBounds.getWidth());
        const auto maxToastWidth = std::min(360, std::max(220, editorBounds.getWidth() - 32));
        const auto anchorRight = anchorX + anchorWidth;
        auto y = static_cast<int>(std::round(anchorY + 48.0f));
        auto drawn = 0;
        for (auto it = toasts_.rbegin(); it != toasts_.rend() && drawn < 3; ++it, ++drawn) {
            const auto title = ::juce::String(it->title);
            const auto message = ::juce::String(it->message);
            g.setFont(::juce::FontOptions(12.0f, ::juce::Font::bold));
            const auto titleWidth = g.getCurrentFont().getStringWidth(title);
            g.setFont(::juce::FontOptions(11.0f));
            const auto messageWidth = g.getCurrentFont().getStringWidth(message);
            const auto width = std::min(maxToastWidth, std::max(180, std::max(titleWidth, messageWidth) + 28));
            const auto height = message.isEmpty() ? 30 : 48;
            const auto x = static_cast<int>(std::round(std::max(anchorX + 12.0f, anchorRight - static_cast<float>(width) - 12.0f)));
            const auto rect = ::juce::Rectangle<int>(width, height).withPosition(x, y);
            const auto accent = diagnosticAccentColour(it->level);

            g.setColour(::juce::Colour(0xe6111827));
            g.fillRoundedRectangle(rect.toFloat(), 8.0f);
            g.setColour(accent.withAlpha(0.72f));
            g.drawRoundedRectangle(rect.toFloat(), 8.0f, 1.0f);
            g.fillRoundedRectangle(rect.withWidth(4).toFloat(), 4.0f);
            g.setColour(::juce::Colour(0xfff8fafc));
            g.setFont(::juce::FontOptions(12.0f, ::juce::Font::bold));
            g.drawText(title, rect.reduced(12, 6).removeFromTop(15), ::juce::Justification::centredLeft, true);
            if (!message.isEmpty()) {
                g.setColour(::juce::Colour(0xffcbd5e1));
                g.setFont(::juce::FontOptions(11.0f));
                g.drawText(message, rect.reduced(12, 6).withTrimmedTop(17), ::juce::Justification::centredLeft, true);
            }
            y += height + 8;
        }
    }

    void DiagnosticsOverlay::paintErrorScreen(::juce::Graphics& g, ::juce::Rectangle<int> editorBounds, const ErrorScreenModel& error, bool detailed) const {
        auto area = editorBounds.reduced(20);
        if (detailed) {
            g.setColour(::juce::Colour(0xff2a1014));
            g.fillRoundedRectangle(area.toFloat(), 10.0f);
            g.setColour(::juce::Colour(0xffff6b6b));
            g.setFont(::juce::FontOptions(18.0f, ::juce::Font::bold));
            g.drawText(error.title.empty() ? "Arrange Error" : error.title, area.removeFromTop(34), ::juce::Justification::centredLeft, true);
            g.setColour(::juce::Colours::white.withAlpha(0.88f));
            g.setFont(::juce::FontOptions(13.0f));
            auto body = error.diagnosticText();
            if (error.retryAvailable) body += "\nClick anywhere to retry.";
            g.drawFittedText(body, area, ::juce::Justification::topLeft, 8);
            return;
        }

        g.setColour(::juce::Colour(0xff111827));
        g.fillRoundedRectangle(area.toFloat(), 10.0f);
        g.setColour(::juce::Colour(0xfff59e0b));
        g.setFont(::juce::FontOptions(17.0f, ::juce::Font::bold));
        g.drawText("Arrange error screen hidden", area.removeFromTop(32), ::juce::Justification::centredLeft, true);
        g.setColour(::juce::Colours::white.withAlpha(0.78f));
        g.setFont(::juce::FontOptions(13.0f));
        g.drawFittedText(error.summary + "\nError details are still available in logs and Cmd/Ctrl+C diagnostics.", area, ::juce::Justification::topLeft, 4);
    }

    std::string DiagnosticsOverlay::diagnosticsText(const DiagnosticsTextContext& context) const {
        std::ostringstream out;
#if defined(NDEBUG)
out<< "buildMode: Release\n";
#else
out<< "buildMode: Debug\n";
#endif
out<< "activeSource: " << context.activeSource<< "\n";
out<< "liveRuntimeEnabled: " << (context.liveRuntimeEnabled? "true" : "false") << "\n";
out<< "hasLive: " << (context.hasLive? "true" : "false") << "\n";
out<< "hasDist: " << (context.hasDist? "true" : "false") << "\n";
  if (!context.devServerUrl.empty()) out<< "devServerUrl: " << context.devServerUrl<< "\n";
  if (!context.appPath.empty()) out<< "appPath: " << context.appPath.string()<< "\n";
  if (context.error!= nullptr) {
    out << "\nerror:\n";
    out << context.error->diagnosticText();
  }
  if (!events_.empty()) {
    out << "\nrecentEvents:\n";
    for (const auto& event : events_) out << event << "\n";
  }
  return out.str();
}

std::string DiagnosticsOverlay::currentLocalTimeLabel() {
    const auto now = std::chrono::system_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;
    const auto nowTime = std::chrono::system_clock::to_time_t(now);
    std::tm localTime{};
#if defined(_WIN32)
localtime_s (&localTime, &nowTime);
#else
localtime_r (&nowTime, &localTime);
#endif
std::ostringstream out;
out<< std::put_time (&localTime, "%H:%M:%S") << "." << std::setw (3) << std::setfill ('0') << ms.count();
  return out.str();
}

bool DiagnosticsOverlay::visibilityEnabled(DiagnosticVisibility visibility) noexcept {
    switch (visibility) {
    case DiagnosticVisibility::Hidden:
        return false;
    case DiagnosticVisibility::Always:
        return true;
    case DiagnosticVisibility::DebugOnly:
#if defined(NDEBUG)
return false;
#else
return true;
#endif
}
  return false;
}

void DiagnosticsOverlay::recordEvent(LogLevel level, const std::string& title, const std::string& message) {
    auto line = std::string("[") + logLevelLabel(level) + "] " + title;
    if (!message.empty()) line += " - " + message;
    events_.push_back(std::move(line));
    while (events_.size() > 20) events_.erase(events_.begin());
}

void DiagnosticsOverlay::writeLog(LogLevel level, const std::string& title, const std::string& message) const {
    if (!logLevelEnabled(level, config_.logLevel)) return;
    auto line = std::string("[arrange][") + logLevelLabel(level) + "] " + title;
    if (!message.empty()) line += " - " + message;
    ::juce::Logger::writeToLog(::juce::String(line));
    if (config_.logFile.empty()) return;

    const auto file = ::juce::File(::juce::String(config_.logFile));
    const auto parent = file.getParentDirectory();
    if (parent.exists() || parent.createDirectory()) { if (file.appendText(::juce::String(line + "\n"), false, false, "\n")) return; }
    ::juce::Logger::writeToLog("Arrange diagnostic log sink failed: " + file.getFullPathName());
}

bool DiagnosticsOverlay::pushToast(LogLevel level, std::string title, std::string message, double nowMillis, bool coalesce) {
    if (!visibilityEnabled(config_.toasts)) return false;
    if (coalesce) {
        for (auto& toast : toasts_) {
            if (toast.title == title) {
                toast.level = level;
                toast.message = std::move(message);
                toast.expiresAtMs = nowMillis + 2500.0;
                return true;
            }
        }
    }
    toasts_.push_back({level, std::move(title), std::move(message), nowMillis + 2500.0});
    while (toasts_.size() > 3) toasts_.erase(toasts_.begin());
    return true;
}

} // namespace arrange::juce

#endif
