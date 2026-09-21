#include <arrange/core/Mutation.h>

namespace arrange::core {
    NodeType nodeTypeFromName(std::string_view name) noexcept {
        if (name == "Root") return NodeType::Root;
        if (name == "LayoutNode") return NodeType::Layout;
        return NodeType::Unknown;
    }
}  // namespace arrange::core
