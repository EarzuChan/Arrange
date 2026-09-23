#pragma once

#include <map>
#include <string>
#include <variant>
#include <vector>

namespace arrange::quickjs {
    // 开发服务器网络协议在 JUCE 层解码；进入 QuickJS 时逐项构造 JSValue
    struct HotValue {
        using Array = std::vector<HotValue>;
        using Object = std::map<std::string, HotValue>;
        std::variant<std::monostate, bool, double, std::string, Array, Object> value;
    };

    struct LiveModuleSource {
        std::string url;
        std::string source;
        std::string sourceMap;
    };

    struct LiveModuleSnapshot {
        std::string entry;
        std::vector<LiveModuleSource> modules;
    };

    struct HotUpdate {
        std::string type;
        std::string path;
        std::string acceptedPath;
        double timestamp = 0;
        bool explicitImportRequired = false;
        std::string firstInvalidatedBy;
    };

    struct HotMessage {
        std::string type;
        std::vector<HotUpdate> updates;
        std::vector<std::string> paths;
        std::string event;
        HotValue data;
    };
}  // namespace arrange::quickjs
