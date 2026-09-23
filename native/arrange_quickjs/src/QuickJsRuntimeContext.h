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
        std::function<void()> wakeOwner;
        bool frameRequested = false;
        bool framePrepared = false;
        JSValue prepareFrame = JS_UNDEFINED;
        JSValue completeFrame = JS_UNDEFINED;
        JSValue disposeApp = JS_UNDEFINED;
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
        // 已接收的类型化输入，提交期间包含候选；不创建 Modifier 实例或预测原生 handle
        std::unordered_map<arrange::core::NodeId, std::vector<PublishedModifier>> modifierInputs;
        std::uint64_t rejectedBindingUpdates = 0;
        QuickJsModuleLoader moduleLoader;
        arrange::core::PainterLoader painterLoader;
        std::unique_ptr<QuickJsPainterResources> painters;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeType> nodeTypes;
        std::unordered_map<arrange::core::NodeId, std::uint64_t> nodeGenerations;
        std::unordered_map<arrange::core::NodeId, std::unordered_map<arrange::core::HostInput, arrange::core::BindingHandle>> hostBindings;
        std::unordered_map<arrange::core::NodeId, arrange::core::BindingHandle> modifierBindings;
        std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>> childrenByNode;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeId> parentByNode;
        std::vector<QuickJsToastRequest> diagnosticToasts;
        std::vector<QuickJsDiagnosticAction> diagnosticActions;
        std::vector<HotMessage> hotMessages;
        std::string hotSession;

        struct RearrangeCheckpoint {
            arrange::core::NodeId root;
            std::optional<arrange::core::MutationTransaction> pending;
            decltype(bindings) savedBindings;
            decltype(publishedModifiers) savedPublishedModifiers;
            decltype(modifierInputs) savedModifierInputs;
            decltype(nodeTypes) savedNodeTypes;
            decltype(nodeGenerations) savedNodeGenerations;
            decltype(hostBindings) savedHostBindings;
            decltype(modifierBindings) savedModifierBindings;
            decltype(childrenByNode) savedChildrenByNode;
            decltype(parentByNode) savedParentByNode;
        };

        std::optional<RearrangeCheckpoint> rearrangeCheckpoint;
        std::shared_ptr<arrange::core::RearrangeSubmission> rearrangeSubmission;
        JSValue rearrangeCompletion = JS_UNDEFINED;
        void beginRearrange();
        void abortRearrange();
        void commitRearrange();

        arrange::core::MutationTransaction* currentTransaction() noexcept;
        void push(arrange::core::TreeMutation mutation);
        arrange::core::BindingHandle registerBinding(arrange::core::BindingTarget target);
        void updateBinding(arrange::core::BindingHandle handle, arrange::core::SlotValue value);
        void retireBinding(arrange::core::BindingHandle handle);
        std::vector<const arrange::core::ModifierDescriptor*> modifierInputDescriptors(arrange::core::NodeId id) const;
        void setHostInput(arrange::core::NodeId id, arrange::core::HostInput input, arrange::core::PropValue value);
        void setModifierChain(arrange::core::NodeId id, arrange::core::ModifierDescriptors value);
        void attachChild(arrange::core::NodeId parent, arrange::core::NodeId child, std::uint32_t index);
        void detachChild(arrange::core::NodeId parent, arrange::core::NodeId child);
        void retireSubtree(arrange::core::NodeId id);
        void recordToast(QuickJsToastRequest toast);
        void recordDiagnosticAction(QuickJsDiagnosticAction action);
    };
}  // namespace arrange::quickjs

#endif
