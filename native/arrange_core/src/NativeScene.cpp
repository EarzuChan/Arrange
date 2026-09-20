#include <arrange/core/NativeScene.h>

#include <stdexcept>
#include <type_traits>

namespace arrange::core {
    void NativeScene::reset() {
        tree_ = {};
        bindings_.clear();
        activeEventSlots_.clear();
        slotCounters_ = {};
    }

    void NativeScene::apply(const MutationTransaction& transaction) {
        if (transaction.rearrange && transaction.rearrange->cancelled) return;
        // 直接调用 apply 也具有失败原子性；帧流水线在自己的候选 scene 上调用同一实现
        auto candidate = *this;
        candidate.applyUncommitted(transaction);
        *this = std::move(candidate);
    }

    bool NativeScene::targetIsLive(const BindingTarget& target) const {
        return std::visit([&](const auto& input) {
            if (!tree_.contains(input.node.id) || input.node.generation == 0 || tree_.node(input.node.id).generation != input.node.generation) return false;
            if constexpr (std::is_same_v<std::decay_t<decltype(input)>, ModifierInputTarget>) return tree_.node(input.node.id).modifier.find(input.modifier) != nullptr;
            return true;
        }, target);
    }

    void NativeScene::retireInvalidBindings() {
        for (auto it = bindings_.begin(); it != bindings_.end();) {
            if (!targetIsLive(it->second.target)) { it = bindings_.erase(it); ++slotCounters_.retirements; }
            else ++it;
        }
    }

    std::uint32_t NativeScene::applySlot(const BindingTarget& target, const SlotValue& value) {
        return std::visit([&](const auto& input) -> std::uint32_t {
            using T = std::decay_t<decltype(input)>;
            if constexpr (std::is_same_v<T, HostInputTarget>) {
                const auto* typed = std::get_if<PropValue>(&value);
                if (!typed) throw std::invalid_argument("Arrange host binding payload type mismatch");
                return tree_.setHostInput(input.node.id, input.input, *typed);
            }
            else if constexpr (std::is_same_v<T, ModifierInputTarget>) {
                const auto* typed = std::get_if<ModifierValue>(&value);
                if (!typed) throw std::invalid_argument("Arrange Modifier binding payload type mismatch");
                return tree_.setModifierInput(input.node.id, input.modifier, *typed);
            }
            else if constexpr (std::is_same_v<T, ModifierChainTarget>) {
                const auto* typed = std::get_if<ModifierDescriptors>(&value);
                if (!typed) throw std::invalid_argument("Arrange Modifier chain binding payload type mismatch");
                return tree_.setModifierChain(input.node.id, *typed);
            }
        }, target);
    }

    void NativeScene::applyUncommitted(const MutationTransaction& transaction) {
        for (const auto& operation : transaction.operations) {
            if (const auto* mutation = std::get_if<TreeMutation>(&operation)) {
                tree_.applyMutation(*mutation);
                retireInvalidBindings();
                std::erase_if(activeEventSlots_, [&](const auto& slot) { return !tree_.contains(slot.node); });
            }
            else if (const auto* registration = std::get_if<RegisterBinding>(&operation)) {
                if (!registration->handle.valid()) throw std::invalid_argument("Arrange invalid binding handle");
                if (!targetIsLive(registration->target)) { ++slotCounters_.rejected; continue; }
                if (bindings_.contains(registration->handle.identity)) throw std::invalid_argument("Arrange duplicate binding registration");
                if (const auto* host = std::get_if<HostInputTarget>(&registration->target)) (void)hostInputName(host->input);
                bindings_.emplace(registration->handle.identity, *registration);
                ++slotCounters_.registrations;
            }
            else if (const auto* retirement = std::get_if<RetireBinding>(&operation)) {
                const auto handle = retirement->handle;
                const auto found = bindings_.find(handle.identity);
                if (found == bindings_.end() || found->second.handle != handle) { ++slotCounters_.rejected; continue; }
                bindings_.erase(found);
                ++slotCounters_.retirements;
            }
            else if (const auto* update = std::get_if<SlotUpdate>(&operation)) {
                const auto found = bindings_.find(update->binding.identity);
                if (found == bindings_.end() || found->second.handle != update->binding || !targetIsLive(found->second.target)) { ++slotCounters_.rejected; continue; }
                const auto mask = applySlot(found->second.target, update->value);
                ++slotCounters_.updates;
                if (mask == 0) ++slotCounters_.unchanged;
                retireInvalidBindings();
            }
            else if (const auto* registration = std::get_if<RegisterEventSlot>(&operation)) {
                if (!registration->slot.valid() || !tree_.contains(registration->slot.node)) throw std::invalid_argument("Arrange event resource target is not live");
                activeEventSlots_.insert(registration->slot);
            }
            else {
                activeEventSlots_.erase(std::get<RetireEventSlot>(operation).slot);
            }
        }
        // 回调资源仅属于存续 Modifier 实例，精确参数更新也遵守同一退休规则
        std::erase_if(activeEventSlots_, [&](const auto& slot) {
            if (!tree_.contains(slot.node)) return true;
            for (const auto& instance : tree_.node(slot.node).modifier.elements()) {
                if (modifierEventSlot(instance.descriptor.value, slot.kind) == slot) return false;
            }
            return true;
        });
    }

    bool NativeScene::hasEventSlot(const EventSlotId& slot) const {
        return slot.valid() && activeEventSlots_.contains(slot);
    }
} // namespace arrange::core
