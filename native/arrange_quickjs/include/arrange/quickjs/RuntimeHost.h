#pragma once
#include <string_view>

namespace arrange::quickjs {
    class RuntimeHost {
    public:
        virtual ~RuntimeHost() = default;
        virtual void loadModule(std::string_view moduleName, std::string_view source) = 0;
    };
}
