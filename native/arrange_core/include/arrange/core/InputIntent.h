#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "MutationTransaction.h"
#include "Node.h"

#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace arrange::core {
    enum class InputIntentKind {
        JsCommit,
        AnimationFrame,
        Pointer,
        Wheel,
        Key,
        TextInput,
        ImeComposition,
        Resize,
        PackageLoad,
        Reload,
        HmrReload,
        ResourceReady,
        ResourceFailed,
        DiagnosticsEvent,
    };

    struct InputIntent {
        InputIntentKind kind = InputIntentKind::JsCommit;
        std::string reason;
        std::optional<NodeId> target;
        std::optional<EventSlotId> eventSlot;
        std::optional<MutationTransaction> transaction;
        std::optional<Constraints> constraints;
        bool needsFullFallback = false;

        static InputIntent jsCommit(MutationTransaction transaction, std::string reason = "js commit") {
            InputIntent intent;
            intent.kind = InputIntentKind::JsCommit;
            intent.reason = std::move(reason);
            intent.transaction = std::move(transaction);
            return intent;
        }

        static InputIntent animationFrame(std::string reason = "animation frame") {
            InputIntent intent;
            intent.kind = InputIntentKind::AnimationFrame;
            intent.reason = std::move(reason);
            return intent;
        }

        static InputIntent pointer(std::string reason = "pointer input", std::optional<NodeId> target = std::nullopt) {
            InputIntent intent;
            intent.kind = InputIntentKind::Pointer;
            intent.reason = std::move(reason);
            intent.target = target;
            return intent;
        }

        static InputIntent wheel(std::string reason = "wheel input", std::optional<NodeId> target = std::nullopt, std::optional<EventSlotId> eventSlot = std::nullopt) {
            InputIntent intent;
            intent.kind = InputIntentKind::Wheel;
            intent.reason = std::move(reason);
            intent.target = target;
            intent.eventSlot = std::move(eventSlot);
            return intent;
        }

        static InputIntent key(std::string reason = "key input", std::optional<NodeId> target = std::nullopt) {
            InputIntent intent;
            intent.kind = InputIntentKind::Key;
            intent.reason = std::move(reason);
            intent.target = target;
            return intent;
        }

        static InputIntent textInput(std::string reason = "text input", std::optional<NodeId> target = std::nullopt) {
            InputIntent intent;
            intent.kind = InputIntentKind::TextInput;
            intent.reason = std::move(reason);
            intent.target = target;
            return intent;
        }

        static InputIntent imeComposition(std::string reason = "ime composition", std::optional<NodeId> target = std::nullopt) {
            InputIntent intent;
            intent.kind = InputIntentKind::ImeComposition;
            intent.reason = std::move(reason);
            intent.target = target;
            return intent;
        }

        static InputIntent resize(Constraints constraints, std::string reason = "viewport resize") {
            InputIntent intent;
            intent.kind = InputIntentKind::Resize;
            intent.reason = std::move(reason);
            intent.constraints = constraints;
            return intent;
        }

        static InputIntent diagnostics(std::string reason) {
            InputIntent intent;
            intent.kind = InputIntentKind::DiagnosticsEvent;
            intent.reason = std::move(reason);
            return intent;
        }

        static InputIntent packageLoad(MutationTransaction transaction, std::string reason = "package load") {
            InputIntent intent;
            intent.kind = InputIntentKind::PackageLoad;
            intent.reason = std::move(reason);
            intent.transaction = std::move(transaction);
            return intent;
        }

        static InputIntent reload(std::string reason = "reload") {
            InputIntent intent;
            intent.kind = InputIntentKind::Reload;
            intent.reason = std::move(reason);
            intent.needsFullFallback = true;
            return intent;
        }

        static InputIntent hmrReload(std::string reason = "hmr reload") {
            InputIntent intent;
            intent.kind = InputIntentKind::HmrReload;
            intent.reason = std::move(reason);
            intent.needsFullFallback = true;
            return intent;
        }

        static InputIntent resourceReady(std::string reason = "resource ready") {
            InputIntent intent;
            intent.kind = InputIntentKind::ResourceReady;
            intent.reason = std::move(reason);
            return intent;
        }

        static InputIntent resourceFailed(std::string reason = "resource failed") {
            InputIntent intent;
            intent.kind = InputIntentKind::ResourceFailed;
            intent.reason = std::move(reason);
            return intent;
        }
    };

    class InputIntentQueue {
    public:
        [[nodiscard]] bool empty() const noexcept { return intents_.empty(); }
        [[nodiscard]] std::size_t size() const noexcept { return intents_.size(); }

        void push(InputIntent intent) { intents_.push_back(std::move(intent)); }

        [[nodiscard]] std::vector<InputIntent> take() noexcept {
            auto intents = std::move(intents_);
            intents_.clear();
            return intents;
        }

        void clear() noexcept { intents_.clear(); }

    private:
        std::vector<InputIntent> intents_;
    };
} // namespace arrange::core
