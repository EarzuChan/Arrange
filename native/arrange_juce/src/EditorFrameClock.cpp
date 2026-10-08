#include <arrange/juce/EditorFrameClock.h>
#include "ScrollProbe.h"

#if ARRANGE_JUCE_WITH_JUCE

#include <utility>

namespace arrange::juce {
    namespace {
        class JuceVBlankSource final : public VBlankSource {
           public:
            explicit JuceVBlankSource(::juce::Component& owner) : owner_(owner) {}

            void start(Callback callback) override {
                attachment_ = std::make_unique<::juce::VBlankAttachment>(&owner_, [callback = std::move(callback)](double seconds) { callback(seconds * 1000.0); });
            }

            void stop() noexcept override {
                attachment_.reset();
            }

           private:
            ::juce::Component& owner_;
            std::unique_ptr<::juce::VBlankAttachment> attachment_;
        };
    }

    EditorFrameClock::~EditorFrameClock() = default;

    void EditorFrameClock::sync(::juce::Component& owner, bool running, VBlankTickCallback onVBlankTick) {
        const auto wasActive = driver_ && driver_->active();
        const auto recordClock = [&] {
            if (!ScrollProbe::active()) return;
            ScrollProbe::Sample sample;
            sample.kind = ScrollProbe::Kind::Clock;
            sample.peer = owner.getPeer() != nullptr;
            sample.pending = running;
            sample.valid = driver_ && driver_->active();
            sample.changed = wasActive != sample.valid;
            ScrollProbe::record(sample);
        };
        // 无 peer 时保留待执行工作；不制造 timer 视觉帧
        if (!running || owner.getPeer() == nullptr) {
            stop();
            recordClock();
            return;
        }
        if (!source_) {
            source_ = std::make_unique<JuceVBlankSource>(owner);
            driver_ = std::make_unique<VBlankFrameDriver>(*source_);
        }
        driver_->start(std::move(onVBlankTick));
        recordClock();
    }

    void EditorFrameClock::stop() noexcept {
        if (insideVBlankCallback_) {
            resyncAfterVBlank_ = true;
            return;
        }
        if (driver_) driver_->stop();
    }

    void EditorFrameClock::beginVBlankCallback() noexcept {
        insideVBlankCallback_ = true;
    }

    bool EditorFrameClock::endVBlankCallback() noexcept {
        insideVBlankCallback_ = false;
        return std::exchange(resyncAfterVBlank_, false);
    }
}
#endif
