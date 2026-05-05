#pragma once

#include <cstdint>
#include <string>
#include <unordered_set>
#include "ScriptHost.h"

namespace arrange::quickjs {
    class CallbackRegistry {
    public:
        void add(std::uint32_t handle) { if (handle != 0) handles_.insert(handle); }
        void remove(std::uint32_t handle) { handles_.erase(handle); }
        void clear() noexcept { handles_.clear(); }
        bool contains(std::uint32_t handle) const { return handles_.find(handle) != handles_.end(); }
        std::size_t size() const noexcept { return handles_.size(); }

    private:
        std::unordered_set<std::uint32_t> handles_;
    };

    struct CallbackDispatchResult {
        bool ok = false;
        std::string error;
    };

    class CallbackDispatcher {
    public:
        CallbackDispatcher(CallbackRegistry& registry, ScriptHost& host) : registry_(registry), host_(host) {}
        CallbackDispatchResult dispatch(std::uint32_t handle, const CallbackInvokeOptions& options = {});

    private:
        CallbackRegistry& registry_;
        ScriptHost& host_;
    };
} // namespace arrange::quickjs
