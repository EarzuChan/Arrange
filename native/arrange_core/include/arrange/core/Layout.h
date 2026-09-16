#pragma once

#include "Geometry.h"
#include "Modifier.h"
#include "LayoutTree.h"
#include <vector>

namespace arrange::core {
    class TextLayoutService;

    class LayoutEngine {
    public:
        LayoutEngine();
        explicit LayoutEngine(const TextLayoutService& textLayoutService);

        void layout(LayoutTree& tree, NodeId root, Constraints constraints);
        Size measure(LayoutTree& tree, NodeId id, Constraints constraints);
        void place(LayoutTree& tree, NodeId id, float x = 0.0f, float y = 0.0f);

    private:
        Size measureWithModifier(LayoutTree& tree, NodeId id, std::size_t index, Constraints constraints);
        Size measureContent(LayoutTree& tree, NodeId id, Constraints constraints);
        void placeWithModifier(LayoutTree& tree, NodeId id, std::size_t index, float x, float y);
        void placeContent(LayoutTree& tree, NodeId id, float x, float y, float width, float height);
        static float rowSpacing(const ArrangeNode& node);
        static float columnSpacing(const ArrangeNode& node);

        const TextLayoutService* textLayoutService_ = nullptr;
    };
} // namespace arrange::core
