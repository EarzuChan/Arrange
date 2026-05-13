#include <arrange/core/Mutation.h>

namespace arrange::core {
    NodeType nodeTypeFromName(std::string_view name) noexcept {
        if (name == "Box") return NodeType::Box;
        if (name == "Row") return NodeType::Row;
        if (name == "Column") return NodeType::Column;
        if (name == "Spacer") return NodeType::Spacer;
        if (name == "Text") return NodeType::Text;
        if (name == "Input") return NodeType::Input;
        if (name == "Image") return NodeType::Image;
        if (name == "Icon") return NodeType::Icon;
        if (name == "Canvas") return NodeType::Canvas;
        return NodeType::Unknown;
    }
} // namespace arrange::core
