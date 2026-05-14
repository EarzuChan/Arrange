#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsEventRegistry.h"
#include "QuickJsModuleLoader.h"
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
        arrange::core::MutationTransactionQueue* pendingTransactions = nullptr;
        QuickJsEventRegistry events;
        QuickJsModuleLoader moduleLoader;
        std::unordered_map<std::uint32_t, JSValue> animationFrameCallbacks;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeType> nodeTypes;
        std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>> childrenByNode;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeId> parentByNode;
        bool reloadRequested = false;
        ReloadRequest reloadRequest;
        std::string nativeError;
        std::vector<QuickJsDiagnosticEventInput> diagnosticEvents;
        std::vector<QuickJsDiagnosticAction> diagnosticActions;

        arrange::core::MutationTransaction* currentTransaction() noexcept;
        void push(arrange::core::TreeMutation mutation);
        void attachChild(arrange::core::NodeId parent, arrange::core::NodeId child, std::uint32_t index);
        void detachChild(arrange::core::NodeId parent, arrange::core::NodeId child);
        void releaseNodeCallbacksRecursive(arrange::core::NodeId id);
        void releaseNodeTypesRecursive(arrange::core::NodeId id);
        void recordDiagnostic(QuickJsDiagnosticEventInput event);
        void recordDiagnosticAction(QuickJsDiagnosticAction action);
    };
}

#endif
