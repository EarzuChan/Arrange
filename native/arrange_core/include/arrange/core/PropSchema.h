#pragma once

#include "Mutation.h"

#include <string>

namespace arrange::core {
    [[nodiscard]] bool validateSetPropMutation(
        NodeType nodeType,
        const std::string& key,
        const PropValue& value,
        std::string& error);
}
