#include <arrange/quickjs/CallbackRegistry.h>

namespace arrange::quickjs {
    CallbackDispatchResult CallbackDispatcher::dispatch(std::uint32_t handle, const CallbackInvokeOptions& options) {
        if (handle == 0) return {false, "Arrange callback handle is zero"};
        if (!registry_.contains(handle)) return {false, "Arrange callback handle is not registered"};
        const auto invoked = host_.invokeCallback(handle, options);
        if (!invoked.ok) return {false, invoked.error.empty() ? "Arrange callback invocation failed" : invoked.error};
        return {true, {}};
    }
} // namespace arrange::quickjs
