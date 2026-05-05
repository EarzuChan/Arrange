#include <arrange/quickjs/AppScriptLoader.h>

#include <fstream>
#include <iterator>

namespace arrange::quickjs {
    ScriptLoadResult AppScriptLoader::loadEntry(const std::filesystem::path& entryPath) {
        ScriptLoadResult result;
        result.modulePath = std::filesystem::absolute(entryPath).lexically_normal();

        std::ifstream stream(result.modulePath, std::ios::binary);
        if (!stream) {
            result.error = "Arrange script entry cannot be opened: " + result.modulePath.string();
            return result;
        }

        const std::string source((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
        const auto execution = host_.executeModule(result.modulePath, source);
        if (!execution.ok) {
            result.error = execution.error.empty() ? "Arrange script execution failed" : execution.error;
            return result;
        }

        result.ok = true;
        return result;
    }
} // namespace arrange::quickjs
