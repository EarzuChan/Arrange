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

    private:
        struct ModifierMetrics {
            float width = -1.0f;
            float height = -1.0f;
            float weight = 0.0f;
            bool weightFill = true;
            float paddingStart = 0.0f;
            float paddingTop = 0.0f;
            float paddingEnd = 0.0f;
            float paddingBottom = 0.0f;
            float verticalScroll = 0.0f;
            float horizontalScroll = 0.0f;
            bool fillMaxWidth = false;
            bool fillMaxHeight = false;
            bool hasVerticalScroll = false;
            bool hasHorizontalScroll = false;
        };

        Size measure(LayoutTree& tree, NodeId id, Constraints constraints);
        Size measureWithModifier(LayoutTree& tree, NodeId id, const CompiledModifier& modifier, std::size_t index, Constraints constraints);
        Size measureContent(LayoutTree& tree, NodeId id, Constraints constraints);
        void place(LayoutTree& tree, NodeId id, float x, float y);
        void placeWithModifier(LayoutTree& tree, NodeId id, const CompiledModifier& modifier, std::size_t index, float x, float y, float width, float height);
        void placeContent(LayoutTree& tree, NodeId id, float x, float y, float width, float height);
        static ModifierMetrics modifierMetrics(const ArrangeNode& node);
        static float rowSpacing(const ArrangeNode& node);
        static float columnSpacing(const ArrangeNode& node);

        const TextLayoutService* textLayoutService_ = nullptr;
    };
} // namespace arrange::core
