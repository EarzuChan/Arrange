#pragma once

#include "EventSlot.h"
#include "Geometry.h"
#include "MutationTransaction.h"
#include "LayoutNode.h"

#include <optional>
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
        std::optional<MutationTransaction> transaction;
        bool needsFullFallback = false;

        static InputIntent jsCommit(MutationTransaction transaction) {
            InputIntent intent;
            intent.kind = InputIntentKind::JsCommit;
            intent.transaction = std::move(transaction);
            return intent;
        }

        static InputIntent animationFrame() {
            InputIntent intent;
            intent.kind = InputIntentKind::AnimationFrame;
            return intent;
        }

        static InputIntent pointer() {
            InputIntent intent;
            intent.kind = InputIntentKind::Pointer;
            return intent;
        }

        static InputIntent wheel() {
            InputIntent intent;
            intent.kind = InputIntentKind::Wheel;
            return intent;
        }

        static InputIntent key() {
            InputIntent intent;
            intent.kind = InputIntentKind::Key;
            return intent;
        }

        static InputIntent textInput() {
            InputIntent intent;
            intent.kind = InputIntentKind::TextInput;
            return intent;
        }

        static InputIntent imeComposition() {
            InputIntent intent;
            intent.kind = InputIntentKind::ImeComposition;
            return intent;
        }

        static InputIntent resize() {
            InputIntent intent;
            intent.kind = InputIntentKind::Resize;
            return intent;
        }

        static InputIntent diagnostics() {
            InputIntent intent;
            intent.kind = InputIntentKind::DiagnosticsEvent;
            return intent;
        }

        static InputIntent packageLoad(MutationTransaction transaction) {
            InputIntent intent;
            intent.kind = InputIntentKind::PackageLoad;
            intent.transaction = std::move(transaction);
            return intent;
        }

        static InputIntent reload() {
            InputIntent intent;
            intent.kind = InputIntentKind::Reload;
            intent.needsFullFallback = true;
            return intent;
        }

        static InputIntent hmrReload() {
            InputIntent intent;
            intent.kind = InputIntentKind::HmrReload;
            intent.needsFullFallback = true;
            return intent;
        }

        static InputIntent resourceReady() {
            InputIntent intent;
            intent.kind = InputIntentKind::ResourceReady;
            return intent;
        }

        static InputIntent resourceFailed() {
            InputIntent intent;
            intent.kind = InputIntentKind::ResourceFailed;
            return intent;
        }
    };

    class InputIntentQueue {
       public:
        [[nodiscard]] bool empty() const noexcept {
            return intents_.empty();
        }

        [[nodiscard]] std::size_t size() const noexcept {
            return intents_.size();
        }

        void push(InputIntent intent) {
            intents_.push_back(std::move(intent));
        }

        [[nodiscard]] std::vector<InputIntent> take() noexcept {
            auto intents = std::move(intents_);
            intents_.clear();
            return intents;
        }

        void clear() noexcept {
            intents_.clear();
        }

       private:
        std::vector<InputIntent> intents_;
    };
}
