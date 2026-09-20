#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <cmath>
#include <limits>

namespace arrange::core {
    std::vector<NodeId> nodePath(const LayoutTree& tree, NodeId node) {
        std::vector<NodeId> path;
        for (auto current = std::optional<NodeId>{node}; current && tree.contains(*current); current = tree.parentOf(*current)) path.push_back(*current);
        std::reverse(path.begin(), path.end());
        return path;
    }

    bool nodeInteractionEnabled(const LayoutTree& tree, NodeId node) {
        for (const auto id : nodePath(tree, node)) {
            const auto found = tree.node(id).props.find("enabled");
            if (found != tree.node(id).props.end() && !found->second.boolOr(true)) return false;
        }
        return tree.contains(node);
    }

    Point rootToNodeContent(const LayoutTree& tree, NodeId node, Point point, ModifierHandle receiver) {
        for (const auto id : nodePath(tree, node)) {
            for (const auto& instance : tree.node(id).modifier.elements()) {
                if (id == node && receiver.valid() && instance.handle == receiver) return point;
                if (const auto* layer = std::get_if<TransformModifierSemantics>(&instance.descriptor.value)) point = inverseLayerPoint(point, instance.bounds, *layer);
            }
        }
        return point;
    }

    Point nodeContentToRoot(const LayoutTree& tree, NodeId node, Point point, ModifierHandle receiver) {
        const auto path = nodePath(tree, node);
        for (auto id = path.rbegin(); id != path.rend(); ++id) {
            const auto& elements = tree.node(*id).modifier.elements();
            auto end = elements.end();
            if (*id == node && receiver.valid()) end = std::find_if(elements.begin(), elements.end(), [&](const auto& item) { return item.handle == receiver; });
            for (auto instance = std::make_reverse_iterator(end); instance != elements.rend(); ++instance) {
                const auto* layer = std::get_if<TransformModifierSemantics>(&instance->descriptor.value);
                if (!layer) continue;
                const auto pivotX = instance->bounds.x + instance->bounds.width * layer->transformOriginX;
                const auto pivotY = instance->bounds.y + instance->bounds.height * layer->transformOriginY;
                const auto angle = layer->rotationZ * 3.14159265358979323846f / 180.0f;
                const auto x = (point.x - pivotX) * layer->scaleX;
                const auto y = (point.y - pivotY) * layer->scaleY;
                point = {pivotX + layer->translationX + x * std::cos(angle) - y * std::sin(angle), pivotY + layer->translationY + x * std::sin(angle) + y * std::cos(angle)};
            }
        }
        return point;
    }

    Rect nodeContentRectToRoot(const LayoutTree& tree, NodeId node, Rect rect, ModifierHandle receiver) {
        const Point corners[]{{rect.x, rect.y}, {rect.x + rect.width, rect.y}, {rect.x, rect.y + rect.height}, {rect.x + rect.width, rect.y + rect.height}};
        auto minimum = nodeContentToRoot(tree, node, corners[0], receiver);
        auto maximum = minimum;
        for (const auto corner : corners) {
            const auto point = nodeContentToRoot(tree, node, corner, receiver);
            minimum.x = std::min(minimum.x, point.x);
            minimum.y = std::min(minimum.y, point.y);
            maximum.x = std::max(maximum.x, point.x);
            maximum.y = std::max(maximum.y, point.y);
        }
        return {minimum.x, minimum.y, maximum.x - minimum.x, maximum.y - minimum.y};
    }

    bool containsRect(Rect bounds, Point point) noexcept {
        return point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
    }

    bool containsShape(Rect bounds, const PaintStyleSemantics& shape, Point point) noexcept {
        if (!containsRect(bounds, point)) return false;
        if (shape.shapeType == "circle") {
            const auto x = (point.x - bounds.x - bounds.width * 0.5f) / (bounds.width * 0.5f);
            const auto y = (point.y - bounds.y - bounds.height * 0.5f) / (bounds.height * 0.5f);
            return x * x + y * y <= 1;
        }
        if (shape.shapeType == "rounded") {
            const auto radius = std::min(shape.cornerRadius, std::min(bounds.width, bounds.height) * 0.5f);
            const auto x = point.x - std::clamp(point.x, bounds.x + radius, bounds.x + bounds.width - radius);
            const auto y = point.y - std::clamp(point.y, bounds.y + radius, bounds.y + bounds.height - radius);
            return x * x + y * y <= radius * radius;
        }
        return true;
    }

    Point inverseLayerPoint(Point point, Rect bounds, const TransformModifierSemantics& transform) noexcept {
        if (transform.scaleX == 0 || transform.scaleY == 0) return {std::numeric_limits<float>::infinity(), std::numeric_limits<float>::infinity()};
        const auto pivotX = bounds.x + bounds.width * transform.transformOriginX;
        const auto pivotY = bounds.y + bounds.height * transform.transformOriginY;
        const auto angle = -transform.rotationZ * 3.14159265358979323846f / 180.0f;
        const auto x = point.x - transform.translationX - pivotX;
        const auto y = point.y - transform.translationY - pivotY;
        return {pivotX + (x * std::cos(angle) - y * std::sin(angle)) / transform.scaleX, pivotY + (x * std::sin(angle) + y * std::cos(angle)) / transform.scaleY};
    }

    bool enterModifier(const ModifierInstance& instance, Point& point) noexcept {
        const auto& value = instance.descriptor.value;
        if (const auto* transform = std::get_if<TransformModifierSemantics>(&value)) {
            point = inverseLayerPoint(point, instance.bounds, *transform);
            if (!std::isfinite(point.x) || !std::isfinite(point.y)) return false;
            if (transform->clip && !containsRect(instance.bounds, point)) return false;
        }
        if (const auto* animation = std::get_if<AnimateContentSizeModifier>(&value); animation && animation->clip && !containsRect(instance.bounds, point)) return false;
        if (const auto* clip = std::get_if<ClipModifier>(&value); clip && !containsShape(instance.bounds, clip->shape, point)) return false;
        if (const auto* layout = std::get_if<LayoutModifierSemantics>(&value); layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll) && !containsRect(instance.bounds, point)) return false;
        return true;
    }
} // namespace arrange::core
