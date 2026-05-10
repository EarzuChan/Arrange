#pragma once

#include <arrange/core/Geometry.h>

#include <filesystem>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;
    struct RuntimeFramePumpResult;

    class RuntimeSessionState final {
    public:
        void reset(
            ArrangeRuntime& runtime,
            DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction);

        void resize(int width, int height, ArrangeRuntime& runtime) noexcept;
        [[nodiscard]] arrange::core::Constraints constraints() const noexcept;

        void markLoaded() noexcept;
        void markUnloaded() noexcept;
        void setLayoutTreeEmptyError(
            DiagnosticsState& diagnostics,
            ArrangeRuntime& runtime);
        [[nodiscard]] bool loaded() const noexcept;
        [[nodiscard]] bool interactive(const DiagnosticsState& diagnostics) const noexcept;

        [[nodiscard]] bool applyFrameError(
            const RuntimeFramePumpResult& frame,
            DiagnosticsState& diagnostics,
            ArrangeRuntime& runtime,
            const std::filesystem::path& relatedPath);

    private:
        bool loaded_ = false;
        int width_ = 0;
        int height_ = 0;
    };

#endif
} // namespace arrange::juce
