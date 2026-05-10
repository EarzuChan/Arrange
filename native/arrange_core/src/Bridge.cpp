#include <arrange/core/Bridge.h>

#include <cstring>
#include <limits>

namespace arrange::core {
    namespace {
        class Reader {
        public:
            explicit Reader(std::span<const std::byte> bytes) : bytes_(bytes) {}

            std::uint32_t u32() {
                ensure(4);
                const auto* p = reinterpret_cast<const unsigned char*>(bytes_.data() + offset_);
                const std::uint32_t value = static_cast<std::uint32_t>(p[0]) |
                    (static_cast<std::uint32_t>(p[1]) << 8) |
                    (static_cast<std::uint32_t>(p[2]) << 16) |
                    (static_cast<std::uint32_t>(p[3]) << 24);
                offset_ += 4;
                return value;
            }

            std::string string(std::uint32_t length) {
                ensure(length);
                std::string result(length, '\0');
                if (length > 0) std::memcpy(result.data(), bytes_.data() + offset_, length);
                offset_ += padded(length);
                if (offset_ > bytes_.size()) throw BridgeDecodeError("Bridge string padding exceeds buffer size");
                return result;
            }

        private:
            static std::size_t padded(std::size_t length) noexcept { return ((length + 3u) / 4u) * 4u; }
            void ensure(std::size_t count) const { if (count > bytes_.size() || offset_ > bytes_.size() - count) throw BridgeDecodeError("Unexpected end of bridge command buffer"); }

            std::span<const std::byte> bytes_;
            std::size_t offset_ = 0;
        };

        const std::string& atString(const std::vector<std::string>& strings, std::uint32_t index) {
            if (index >= strings.size()) throw BridgeDecodeError("Bridge string table index out of range");
            return strings[index];
        }

        std::uint32_t atWord(const std::vector<std::uint32_t>& words, std::size_t& index) {
            if (index >= words.size()) throw BridgeDecodeError("Bridge opcode argument stream ended early");
            return words[index++];
        }
    }

    NodeType nodeTypeFromBridgeName(std::string_view name) noexcept {
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

    BridgeBatch decodeBridgeBatch(std::span<const std::byte> bytes) {
        Reader reader(bytes);
        BridgeBatch batch;
        batch.header.magic = reader.u32();
        batch.header.version = reader.u32();
        batch.header.flags = reader.u32();
        batch.header.opCount = reader.u32();

        if (batch.header.magic != BridgeMagic) throw BridgeDecodeError("Invalid Arrange bridge magic");
        if (batch.header.version != BridgeVersion) throw BridgeDecodeError("Unsupported Arrange bridge version");

        const auto stringCount = reader.u32();
        std::vector<std::string> strings;
        strings.reserve(stringCount);
        for (std::uint32_t i = 0; i < stringCount; ++i) { strings.push_back(reader.string(reader.u32())); }

        const auto wordCount = reader.u32();
        std::vector<std::uint32_t> words;
        words.reserve(wordCount);
        for (std::uint32_t i = 0; i < wordCount; ++i) words.push_back(reader.u32());

        std::size_t cursor = 0;
        batch.ops.reserve(batch.header.opCount);
        for (std::uint32_t opIndex = 0; opIndex < batch.header.opCount; ++opIndex) {
            BridgeOp op;
            op.opcode = static_cast<BridgeOpcode>(atWord(words, cursor));
            switch (op.opcode) {
            case BridgeOpcode::CreateNode:
                op.id = atWord(words, cursor);
                op.nodeType = atString(strings, atWord(words, cursor));
                break;
            case BridgeOpcode::DeleteNode:
                op.id = atWord(words, cursor);
                break;
            case BridgeOpcode::InsertChild:
                op.parent = atWord(words, cursor);
                op.child = atWord(words, cursor);
                op.index = atWord(words, cursor);
                break;
            case BridgeOpcode::RemoveChild:
                op.parent = atWord(words, cursor);
                op.child = atWord(words, cursor);
                break;
            case BridgeOpcode::SetProp:
                op.id = atWord(words, cursor);
                op.key = atString(strings, atWord(words, cursor));
                op.value = atString(strings, atWord(words, cursor));
                break;
            case BridgeOpcode::SetModifier:
                op.id = atWord(words, cursor);
                op.modifierPayload = atString(strings, atWord(words, cursor));
                break;
            case BridgeOpcode::SetText:
                op.id = atWord(words, cursor);
                op.text = atString(strings, atWord(words, cursor));
                break;
            default:
                throw BridgeDecodeError("Unknown Arrange bridge opcode");
            }
            batch.ops.push_back(std::move(op));
        }

        if (cursor != words.size()) throw BridgeDecodeError("Bridge command buffer contains trailing opcode words");
        return batch;
    }
} // namespace arrange::core
