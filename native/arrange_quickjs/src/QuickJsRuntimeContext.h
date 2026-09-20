#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsEventRegistry.h"
#include "QuickJsModuleLoader.h"
#include "QuickJsPainterResources.h"
#include <arrange/quickjs/QuickJsScriptHost.h>
#include <arrange/core/Mutation.h>
#include <arrange/core/MutationTransaction.h>

#include <algorithm>
#include <cstdint>
#include <unordered_map>
#include <utility>
#include <vector>
#include <string>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    struct QuickJsRuntimeContext {
        JSRuntime* runtime = nullptr;
        JSContext* context = nullptr;
        arrange::core::NodeId rootNodeId = 0;
        std::uint32_t nextAnimationFrameHandle = 1;
        double frameTimeMillis = 0.0;
        static constexpr std::size_t maxJobsPerFrame = 10000;
        std::size_t remainingFrameJobs = maxJobsPerFrame;
        arrange::core::MutationTransactionQueue* pendingTransactions = nullptr;
        QuickJsEventRegistry events;
        std::vector<std::pair<JSValue, JSValue>> unhandledRejections;
        std::unordered_map<std::uint64_t, arrange::core::RegisterBinding> bindings;
        struct PublishedModifier {
            arrange::core::NodeHandle node;
            arrange::core::ModifierHandle handle;
            arrange::core::ModifierDescriptor descriptor;
            std::size_t position = 0;
        };
        std::unordered_map<std::uint64_t, PublishedModifier> publishedModifiers;
        std::uint64_t rejectedBindingUpdates = 0;
        QuickJsModuleLoader moduleLoader;
        arrange::core::PainterLoader painterLoader;
        std::unique_ptr<QuickJsPainterResources> painters;
        std::unordered_map<std::uint32_t, JSValue> animationFrameCallbacks;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeType> nodeTypes;
        std::unordered_map<arrange::core::NodeId, std::uint64_t> nodeGenerations;
        std::unordered_map<arrange::core::NodeId, std::unordered_map<arrange::core::HostInput, arrange::core::BindingHandle>> hostBindings;
        std::unordered_map<arrange::core::NodeId, arrange::core::BindingHandle> modifierBindings;
        std::unordered_map<arrange::core::NodeId, std::unordered_map<arrange::core::EventSlotKind, arrange::core::BindingHandle>> eventBindings;
        std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>> childrenByNode;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeId> parentByNode;
        std::vector<QuickJsDiagnosticEventInput> diagnosticEvents;
        std::vector<QuickJsDiagnosticAction> diagnosticActions;

        arrange::core::MutationTransaction* currentTransaction() noexcept;
        void push(arrange::core::TreeMutation mutation);
        arrange::core::BindingHandle registerBinding(arrange::core::BindingTarget target);
        void updateBinding(arrange::core::BindingHandle handle, arrange::core::SlotValue value);
        void retireBinding(arrange::core::BindingHandle handle);
        void setHostInput(arrange::core::NodeId id, arrange::core::HostInput input, arrange::core::PropValue value);
        void setEventInput(arrange::core::NodeId id, arrange::core::EventSlotKind kind, arrange::core::EventSlotId slot);
        void setModifierChain(arrange::core::NodeId id, arrange::core::ModifierDescriptors value);
        void attachChild(arrange::core::NodeId parent, arrange::core::NodeId child, std::uint32_t index);
        void detachChild(arrange::core::NodeId parent, arrange::core::NodeId child);
        void releaseNodeCallbacksRecursive(arrange::core::NodeId id);
        void releaseNodeTypesRecursive(arrange::core::NodeId id);
        void recordDiagnostic(QuickJsDiagnosticEventInput event);
        void recordDiagnosticAction(QuickJsDiagnosticAction action);
    };
}

#endif
