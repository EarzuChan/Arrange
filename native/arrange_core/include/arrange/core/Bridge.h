#pragma once

#include <cstdint>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>
#include "Node.h"
#include "Version.h"

namespace arrange::core {
    enum class BridgeOpcode : std::uint32_t {
        CreateNode = 1,
        DeleteNode = 2,
        InsertChild = 3,
        RemoveChild = 4,
        SetProp = 5,
        SetModifier = 6,
        SetText = 7,
    };

    struct BridgeHeader {
        std::uint32_t magic = 0;
        std::uint32_t version = 0;
        std::uint32_t flags = 0;
        std::uint32_t opCount = 0;
    };

    struct BridgeOp {
        BridgeOpcode opcode = BridgeOpcode::CreateNode;
        NodeId id = 0;
        NodeId parent = 0;
        NodeId child = 0;
        std::uint32_t index = 0;
        std::string nodeType;
        std::string key;
        std::string value;
        std::string text;
        std::string modifierDebugJson;
    };

    struct BridgeBatch {
        BridgeHeader header;
        std::vector<BridgeOp> ops;
    };

    class BridgeDecodeError : public std::runtime_error {
    public:
        using std::runtime_error::runtime_error;
    };

    BridgeBatch decodeBridgeBatch(std::span<const std::byte> bytes);
    NodeType nodeTypeFromBridgeName(std::string_view name) noexcept;
} // namespace arrange::core
