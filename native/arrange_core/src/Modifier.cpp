#include <arrange/core/Modifier.h>
#include <arrange/core/Node.h>

#include <algorithm>
#include <cctype>
#include <optional>

namespace arrange::core {
    namespace {
        std::string keyString(std::string_view key) { return {key.data(), key.size()}; }

        void skipWhitespace(std::string_view text, std::size_t& pos) { while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos; }

        std::string parseJsonString(std::string_view text, std::size_t& pos) {
            std::string result;
            if (pos >= text.size() || text[pos] != '"') return result;
            ++pos;
            bool escaping = false;
            for (; pos < text.size(); ++pos) {
                const auto ch = text[pos];
                if (escaping) {
                    switch (ch) {
                    case 'n':
                        result.push_back('\n');
                        break;
                    case 'r':
                        result.push_back('\r');
                        break;
                    case 't':
                        result.push_back('\t');
                        break;
                    default:
                        result.push_back(ch);
                        break;
                    }
                    escaping = false;
                    continue;
                }
                if (ch == '\\') {
                    escaping = true;
                    continue;
                }
                if (ch == '"') {
                    ++pos;
                    break;
                }
                result.push_back(ch);
            }
            return result;
        }

        std::string encodedJsonPrimitive(std::string_view text, std::size_t& pos) {
            skipWhitespace(text, pos);
            if (pos >= text.size()) return {};
            if (text[pos] == '"') return "s:" + parseJsonString(text, pos);
            const auto start = pos;
            while (pos < text.size() && text[pos] != ',' && text[pos] != '}' && text[pos] != ']') ++pos;
            auto value = text.substr(start, pos - start);
            while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.remove_suffix(1);
            if (value == "true") return "b:1";
            if (value == "false") return "b:0";
            if (value == "null") return "n:";
            return "f:" + std::string(value);
        }

        void parseJsonValue(std::string_view text, std::size_t& pos, const std::string& path, std::unordered_map<std::string, EncodedProp>& props);

        void parseJsonObject(std::string_view text, std::size_t& pos, const std::string& prefix, std::unordered_map<std::string, EncodedProp>& props) {
            skipWhitespace(text, pos);
            if (pos >= text.size() || text[pos] != '{') return;
            ++pos;
            while (pos < text.size()) {
                skipWhitespace(text, pos);
                if (pos < text.size() && text[pos] == '}') {
                    ++pos;
                    return;
                }
                const auto key = parseJsonString(text, pos);
                skipWhitespace(text, pos);
                if (pos >= text.size() || text[pos] != ':') return;
                ++pos;
                const auto path = prefix.empty() ? key : prefix + "." + key;
                parseJsonValue(text, pos, path, props);
                skipWhitespace(text, pos);
                if (pos < text.size() && text[pos] == ',') {
                    ++pos;
                    continue;
                }
            }
        }

        void skipJsonArray(std::string_view text, std::size_t& pos) {
            if (pos >= text.size() || text[pos] != '[') return;
            int depth = 0;
            bool inString = false;
            bool escaping = false;
            for (; pos < text.size(); ++pos) {
                const auto ch = text[pos];
                if (inString) {
                    if (escaping) {
                        escaping = false;
                        continue;
                    }
                    if (ch == '\\') {
                        escaping = true;
                        continue;
                    }
                    if (ch == '"') inString = false;
                    continue;
                }
                if (ch == '"') {
                    inString = true;
                    continue;
                }
                if (ch == '[') ++depth;
                if (ch == ']') {
                    --depth;
                    ++pos;
                    if (depth <= 0) return;
                }
            }
        }

        void parseJsonValue(std::string_view text, std::size_t& pos, const std::string& path, std::unordered_map<std::string, EncodedProp>& props) {
            skipWhitespace(text, pos);
            if (pos < text.size() && text[pos] == '{') {
                parseJsonObject(text, pos, path, props);
                return;
            }
            if (pos < text.size() && text[pos] == '[') {
                skipJsonArray(text, pos);
                return;
            }
            props.emplace(path, EncodedProp(encodedJsonPrimitive(text, pos)));
        }

        std::optional<ModifierElement> parseModifierObject(std::string_view text, std::size_t& pos) {
            std::unordered_map<std::string, EncodedProp> props;
            parseJsonObject(text, pos, {}, props);
            const auto typeIt = props.find("type");
            if (typeIt == props.end()) return std::nullopt;
            ModifierElement element;
            element.type = typeIt->second.stringValue();
            props.erase(typeIt);
            element.props = std::move(props);
            if (element.type.empty()) return std::nullopt;
            return element;
        }
    } // namespace

    bool ModifierElement::has(std::string_view key) const { return props.find(keyString(key)) != props.end(); }

    EncodedProp ModifierElement::prop(std::string_view key) const {
        if (const auto it = props.find(keyString(key)); it != props.end()) return it->second;
        return {};
    }

    float ModifierElement::number(std::string_view key, float fallback) const { return prop(key).floatValue(fallback); }

    bool ModifierElement::boolean(std::string_view key, bool fallback) const { return prop(key).boolValue(fallback); }

    std::string ModifierElement::string(std::string_view key, std::string_view fallback) const { return prop(key).stringValue(fallback); }

    std::uint32_t ModifierElement::handle(std::string_view key, std::uint32_t fallback) const { return prop(key).handleValue(fallback); }

    std::uint32_t ModifierElement::color(std::string_view key, std::uint32_t fallback) const { return prop(key).uint32Value(fallback); }


    namespace {
        float clamped01(float value, float fallback = 0.5f) {
            if (value < 0.0f) return 0.0f;
            if (value > 1.0f) return 1.0f;
            return value == value ? value : fallback;
        }

        ModifierPadding paddingFrom(const ModifierElement& element) {
            return {
                std::max(0.0f, element.number("start")),
                std::max(0.0f, element.number("top")),
                std::max(0.0f, element.number("end")),
                std::max(0.0f, element.number("bottom")),
            };
        }

        std::pair<float, float> transformOriginFrom(const ModifierElement& element) {
            const auto value = element.string("transformOrigin");
            if (value == "TopStart") return {0.0f, 0.0f};
            if (value == "TopCenter") return {0.5f, 0.0f};
            if (value == "TopEnd") return {1.0f, 0.0f};
            if (value == "CenterStart") return {0.0f, 0.5f};
            if (value == "CenterEnd") return {1.0f, 0.5f};
            if (value == "BottomStart") return {0.0f, 1.0f};
            if (value == "BottomCenter") return {0.5f, 1.0f};
            if (value == "BottomEnd") return {1.0f, 1.0f};
            return {
                clamped01(element.number("transformOrigin.x", 0.5f)),
                clamped01(element.number("transformOrigin.y", 0.5f)),
            };
        }

        PaintStyleSemantics paintStyle(const ModifierElement& element) {
            PaintStyleSemantics style;
            style.type = element.type;
            style.color = element.has("color") ? element.color("color") : element.color("color.color");
            style.brush = element.has("brush") ? element.color("brush") : element.color("brush.color");
            style.strokeWidth = std::max(1.0f, element.number("width", 1.0f));
            style.shapeType = element.string("shape.type");
            style.cornerRadius = style.shapeType == "rounded" ? std::max(0.0f, element.number("shape.radius")) : 0.0f;
            style.alpha = std::clamp(element.number("value", 1.0f), 0.0f, 1.0f);
            style.shadowOffset = {element.number("offsetX", element.number("offset.x")), element.number("offsetY", element.number("offset.y"))};
            return style;
        }

        void addDirty(CompiledModifier& modifier, DirtyFlag flag) {
            modifier.affectedDirtyMask |= dirtyMask(flag);
        }

        bool sameSlot(const EventSlotId& left, const EventSlotId& right) {
            return left.node == right.node && left.kind == right.kind && left.path == right.path;
        }

        bool samePadding(const ModifierPadding& left, const ModifierPadding& right) {
            return left.start == right.start && left.top == right.top && left.end == right.end && left.bottom == right.bottom;
        }

        bool sameLayout(const LayoutModifierSemantics& left, const LayoutModifierSemantics& right) {
            return left.kind == right.kind &&
                samePadding(left.padding, right.padding) &&
                left.value == right.value &&
                left.width == right.width &&
                left.height == right.height &&
                left.fraction == right.fraction &&
                left.minWidth == right.minWidth &&
                left.maxWidth == right.maxWidth &&
                left.minHeight == right.minHeight &&
                left.maxHeight == right.maxHeight &&
                left.scrollValue == right.scrollValue;
        }

        bool samePaintStyle(const PaintStyleSemantics& left, const PaintStyleSemantics& right) {
            return left.type == right.type &&
                left.inset.x == right.inset.x &&
                left.inset.y == right.inset.y &&
                left.inset.width == right.inset.width &&
                left.inset.height == right.inset.height &&
                left.color == right.color &&
                left.brush == right.brush &&
                left.strokeWidth == right.strokeWidth &&
                left.shapeType == right.shapeType &&
                left.cornerRadius == right.cornerRadius &&
                left.alpha == right.alpha &&
                left.shadowOffset.x == right.shadowOffset.x &&
                left.shadowOffset.y == right.shadowOffset.y;
        }

        bool samePaintChainOp(const PaintChainOp& left, const PaintChainOp& right) {
            return left.kind == right.kind && samePaintStyle(left.style, right.style) && samePadding(left.padding, right.padding);
        }

        template <typename T, typename Equal>
        bool sameVector(const std::vector<T>& left, const std::vector<T>& right, Equal equal) {
            if (left.size() != right.size()) return false;
            for (std::size_t i = 0; i < left.size(); ++i) {
                if (!equal(left[i], right[i])) return false;
            }
            return true;
        }
    } // namespace

    CompiledModifier ModifierCompiler::compile(std::string_view encodedPayload) const {
        CompiledModifier result;
        for (const auto& element : parseModifierPayload(encodedPayload)) {
            if (element.type == "padding") {
                LayoutModifierSemantics item;
                item.kind = LayoutModifierKind::Padding;
                item.padding = paddingFrom(element);
                result.layout.push_back(item);
                result.paintContentPadding.push_back(item.padding);
                result.paint.chain.push_back({PaintChainOpKind::ContentPadding, paintStyle(element), item.padding});
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "width" || element.type == "height" || element.type == "requiredWidth" || element.type == "requiredHeight") {
                LayoutModifierSemantics item;
                if (element.type == "width") item.kind = LayoutModifierKind::Width;
                else if (element.type == "height") item.kind = LayoutModifierKind::Height;
                else if (element.type == "requiredWidth") item.kind = LayoutModifierKind::RequiredWidth;
                else item.kind = LayoutModifierKind::RequiredHeight;
                item.value = element.number(element.type == "width" || element.type == "height" ? "value" : element.type == "requiredWidth" ? "width" : "height");
                result.layout.push_back(item);
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "size" || element.type == "requiredSize") {
                LayoutModifierSemantics item;
                item.kind = element.type == "size" ? LayoutModifierKind::Size : LayoutModifierKind::RequiredSize;
                item.width = element.number("width");
                item.height = element.number("height");
                result.layout.push_back(item);
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "fillMaxWidth" || element.type == "fillMaxHeight" || element.type == "fillMaxSize") {
                LayoutModifierSemantics item;
                if (element.type == "fillMaxWidth") item.kind = LayoutModifierKind::FillMaxWidth;
                else if (element.type == "fillMaxHeight") item.kind = LayoutModifierKind::FillMaxHeight;
                else item.kind = LayoutModifierKind::FillMaxSize;
                item.fraction = element.number("fraction", 1.0f);
                result.layout.push_back(item);
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "widthIn" || element.type == "heightIn" || element.type == "sizeIn") {
                LayoutModifierSemantics item;
                if (element.type == "widthIn") item.kind = LayoutModifierKind::WidthIn;
                else if (element.type == "heightIn") item.kind = LayoutModifierKind::HeightIn;
                else item.kind = LayoutModifierKind::SizeIn;
                item.minWidth = element.number("min", element.number("minWidth", -1.0f));
                item.maxWidth = element.number("max", element.number("maxWidth", -1.0f));
                item.minHeight = element.number("min", element.number("minHeight", -1.0f));
                item.maxHeight = element.number("max", element.number("maxHeight", -1.0f));
                result.layout.push_back(item);
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "defaultMinSize") {
                LayoutModifierSemantics item;
                item.kind = LayoutModifierKind::DefaultMinSize;
                item.minWidth = element.number("minWidth");
                item.minHeight = element.number("minHeight");
                result.layout.push_back(item);
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "verticalScroll" || element.type == "horizontalScroll") {
                LayoutModifierSemantics item;
                item.kind = element.type == "verticalScroll" ? LayoutModifierKind::VerticalScroll : LayoutModifierKind::HorizontalScroll;
                item.scrollValue = std::max(0.0f, element.number("state.value", element.number("value", 0.0f)));
                result.layout.push_back(item);
                if (element.type == "verticalScroll") {
                    result.scroll.vertical = element.boolean("enabled", true);
                    result.scroll.verticalValue = item.scrollValue;
                    result.scroll.verticalEventSlot = parseEventSlotId(element.string("state.__arrangeNativeScroll.eventSlot"));
                    if (!result.scroll.verticalEventSlot.valid()) result.scroll.verticalEventSlot = parseEventSlotId(element.string("__arrangeNativeScroll.eventSlot"));
                }
                else {
                    result.scroll.horizontal = element.boolean("enabled", true);
                    result.scroll.horizontalValue = item.scrollValue;
                    result.scroll.horizontalEventSlot = parseEventSlotId(element.string("state.__arrangeNativeScroll.eventSlot"));
                    if (!result.scroll.horizontalEventSlot.valid()) result.scroll.horizontalEventSlot = parseEventSlotId(element.string("__arrangeNativeScroll.eventSlot"));
                }
                result.paint.chain.push_back({PaintChainOpKind::Clip, paintStyle(element), {}});
                result.paint.clips.push_back(paintStyle(element));
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "weight") {
                result.parentData.weight = std::max(0.0f, element.number("weight"));
                result.parentData.weightFill = element.boolean("fill", true);
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "align") {
                result.parentData.align = element.string("alignment");
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "offset" || element.type == "absoluteOffset") {
                result.transform.layoutOffsetX += element.number("x");
                result.transform.layoutOffsetY += element.number("y");
                addDirty(result, DirtyFlag::Transform);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "graphicsLayer") {
                result.transform.translationX += element.number("translationX");
                result.transform.translationY += element.number("translationY");
                result.transform.layoutOffsetX += element.number("translationX");
                result.transform.layoutOffsetY += element.number("translationY");
                result.transform.scaleX = element.number("scaleX", 1.0f);
                result.transform.scaleY = element.number("scaleY", 1.0f);
                result.transform.rotationZ = element.number("rotationZ");
                const auto origin = transformOriginFrom(element);
                result.transform.transformOriginX = origin.first;
                result.transform.transformOriginY = origin.second;
                result.transform.hasPaintTransform = std::fabs(result.transform.scaleX - 1.0f) > 0.0001f || std::fabs(result.transform.scaleY - 1.0f) > 0.0001f || std::fabs(result.transform.rotationZ) > 0.0001f;
                addDirty(result, DirtyFlag::Transform);
                if (result.transform.hasPaintTransform) addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "zIndex") {
                result.zIndex = element.number("value");
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "background" || element.type == "border" || element.type == "alpha" || element.type == "dropShadow" || element.type == "innerShadow") {
                const auto style = paintStyle(element);
                result.paint.chain.push_back({PaintChainOpKind::Style, style, {}});
                result.paint.styles.push_back(style);
                addDirty(result, DirtyFlag::Paint);
            }
            else if (element.type == "clip") {
                const auto style = paintStyle(element);
                result.paint.chain.push_back({PaintChainOpKind::Clip, style, {}});
                result.paint.clips.push_back(style);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "clickable") {
                result.input.clickable = element.boolean("enabled", true);
                result.input.focusable = element.boolean("focusable", true);
                result.input.clickEventSlot = parseEventSlotId(element.string("onClick.eventSlot"));
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "hoverable") {
                result.input.hoverable = element.boolean("enabled", true);
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type == "focusable") {
                result.input.focusable = element.boolean("enabled", true);
                addDirty(result, DirtyFlag::HitTest);
                addDirty(result, DirtyFlag::Focus);
            }
            else if (element.type == "pointerInput") {
                result.input.pointerInput = true;
                addDirty(result, DirtyFlag::HitTest);
            }
            else if (element.type != "testTag") {
                addDirty(result, DirtyFlag::Layout);
                addDirty(result, DirtyFlag::Paint);
                addDirty(result, DirtyFlag::HitTest);
            }
        }
        return result;
    }

    CompiledModifier ModifierCompiler::compile(const ArrangeNode& node) const {
        return compile(node.modifierPayload);
    }

    CompiledModifierDiff diffCompiledModifier(const CompiledModifier& before, const CompiledModifier& after) {
        std::uint32_t mask = 0;
        if (!sameVector(before.layout, after.layout, sameLayout) ||
            !sameVector(before.paintContentPadding, after.paintContentPadding, samePadding) ||
            before.parentData.weight != after.parentData.weight ||
            before.parentData.weightFill != after.parentData.weightFill ||
            before.parentData.align != after.parentData.align ||
            before.scroll.vertical != after.scroll.vertical ||
            before.scroll.horizontal != after.scroll.horizontal ||
            before.scroll.verticalValue != after.scroll.verticalValue ||
            before.scroll.horizontalValue != after.scroll.horizontalValue) {
            mask |= dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        if (!sameVector(before.paint.chain, after.paint.chain, samePaintChainOp) ||
            !sameVector(before.paint.styles, after.paint.styles, samePaintStyle) ||
            !sameVector(before.paint.clips, after.paint.clips, samePaintStyle)) {
            mask |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        if (before.transform.layoutOffsetX != after.transform.layoutOffsetX ||
            before.transform.layoutOffsetY != after.transform.layoutOffsetY ||
            before.transform.translationX != after.transform.translationX ||
            before.transform.translationY != after.transform.translationY ||
            before.transform.scaleX != after.transform.scaleX ||
            before.transform.scaleY != after.transform.scaleY ||
            before.transform.rotationZ != after.transform.rotationZ ||
            before.transform.transformOriginX != after.transform.transformOriginX ||
            before.transform.transformOriginY != after.transform.transformOriginY ||
            before.transform.hasPaintTransform != after.transform.hasPaintTransform) {
            mask |= dirtyMask(DirtyFlag::Transform) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        if (before.input.clickable != after.input.clickable ||
            before.input.hoverable != after.input.hoverable ||
            before.input.pointerInput != after.input.pointerInput ||
            !sameSlot(before.input.clickEventSlot, after.input.clickEventSlot) ||
            !sameSlot(before.scroll.verticalEventSlot, after.scroll.verticalEventSlot) ||
            !sameSlot(before.scroll.horizontalEventSlot, after.scroll.horizontalEventSlot)) {
            mask |= dirtyMask(DirtyFlag::HitTest) | dirtyMask(DirtyFlag::EventSlot);
        }
        if (before.input.focusable != after.input.focusable) {
            mask |= dirtyMask(DirtyFlag::Focus) | dirtyMask(DirtyFlag::HitTest);
        }
        if (before.zIndex != after.zIndex) {
            mask |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        return {mask};
    }

    std::vector<ModifierElement> parseModifierPayload(std::string_view encodedPayload) {
        std::string_view text = encodedPayload;
        if (text.rfind("o:", 0) == 0) text.remove_prefix(2);

        std::vector<ModifierElement> elements;
        std::size_t pos = 0;
        skipWhitespace(text, pos);
        if (pos >= text.size() || text[pos] != '[') return elements;
        ++pos;
        while (pos < text.size()) {
            skipWhitespace(text, pos);
            if (pos < text.size() && text[pos] == ']') break;
            if (pos >= text.size() || text[pos] != '{') break;
            if (auto element = parseModifierObject(text, pos)) elements.push_back(std::move(*element));
            skipWhitespace(text, pos);
            if (pos < text.size() && text[pos] == ',') {
                ++pos;
                continue;
            }
        }
        return elements;
    }
} // namespace arrange::core
