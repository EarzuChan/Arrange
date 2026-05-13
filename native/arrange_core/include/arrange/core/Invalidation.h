#pragma once

#include "Node.h"

#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace arrange::core {
    enum class InvalidationSource {
        Unknown,
        NativeMutation,
        NativeState,
        InputIntent,
        Resize,
        Resource,
        Diagnostics,
        Fallback,
    };

    struct DirtyAttribution {
        InvalidationSource source = InvalidationSource::Unknown;
        std::optional<NodeId> node;
        std::uint32_t dirty = 0;
        std::string field;
        std::string reason;

        [[nodiscard]] bool affects(DirtyFlag flag) const noexcept {
            return (dirty & dirtyMask(flag)) != 0;
        }
    };

    struct InvalidationSnapshot {
        std::vector<DirtyAttribution> attributions;
        std::uint32_t combinedDirty = 0;
        bool needsFullFallback = false;
        std::string fallbackReason;

        [[nodiscard]] bool empty() const noexcept {
            return attributions.empty() && combinedDirty == 0 && !needsFullFallback;
        }

        [[nodiscard]] bool affects(DirtyFlag flag) const noexcept {
            return (combinedDirty & dirtyMask(flag)) != 0;
        }
    };

    class InvalidationGraph {
    public:
        void record(DirtyAttribution attribution) {
            snapshot_.combinedDirty |= attribution.dirty;
            snapshot_.attributions.push_back(std::move(attribution));
        }

        void record(
            InvalidationSource source,
            std::optional<NodeId> node,
            std::uint32_t dirty,
            std::string field,
            std::string reason) {
            record({source, node, dirty, std::move(field), std::move(reason)});
        }

        void requireFullFallback(std::string reason) {
            snapshot_.needsFullFallback = true;
            snapshot_.fallbackReason = std::move(reason);
        }

        [[nodiscard]] const InvalidationSnapshot& snapshot() const noexcept { return snapshot_; }

        [[nodiscard]] InvalidationSnapshot take() noexcept {
            auto snapshot = std::move(snapshot_);
            snapshot_ = {};
            return snapshot;
        }

        void clear() noexcept { snapshot_ = {}; }

    private:
        InvalidationSnapshot snapshot_;
    };
} // namespace arrange::core

