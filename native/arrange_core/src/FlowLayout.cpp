#include <arrange/core/Layout.h>

#include <algorithm>
#include <cmath>

namespace arrange::core {
    namespace {
        float mainSize(Size size, bool horizontal) {
            return horizontal ? size.width : size.height;
        }

        float crossSize(Size size, bool horizontal) {
            return horizontal ? size.height : size.width;
        }

        Size measuredSize(const LayoutNode& node) {
            return {node.bounds.width, node.bounds.height};
        }

        Constraints childConstraints(bool horizontal, float minMain, float maxMain, float maxCross) {
            return horizontal ? Constraints{minMain, maxMain, 0, maxCross} : Constraints{0, maxCross, minMain, maxMain};
        }

        struct ArrangementPlacement {
            float offset = 0, spacing = 0;
        };

        ArrangementPlacement arrange(float available, float used, std::size_t count, const AxisArrangement& arrangement) {
            ArrangementPlacement result{0, arrangement.spacing};
            const auto remaining = std::max(0.0f, available - used);
            const auto& alignment = arrangement.alignment;
            if (alignment == "Center" || alignment == "CenterHorizontally" || alignment == "CenterVertically")
                result.offset = remaining / 2;
            else if (alignment == "End" || alignment == "Bottom")
                result.offset = remaining;
            else if (alignment == "SpaceBetween" && count > 1)
                result.spacing = remaining / (count - 1);
            else if (alignment == "SpaceAround" && count) {
                result.spacing = remaining / count;
                result.offset = result.spacing / 2;
            } else if (alignment == "SpaceEvenly" && count) {
                result.spacing = remaining / (count + 1);
                result.offset = result.spacing;
            }
            return result;
        }

        float align(float parent, float child, const std::string& alignment) {
            if (alignment == "Center" || alignment == "CenterHorizontally" || alignment == "CenterVertically") return (parent - child) / 2;
            if (alignment == "End" || alignment == "Bottom") return parent - child;
            return 0;
        }
    }

    Size LayoutEngine::measureFlow(LayoutTree& tree, LayoutNode& node, Constraints constraints, const FlowMeasurePolicy& policy) {
        const auto horizontal = policy.horizontal;
        const auto maxMain = horizontal ? constraints.maxWidth : constraints.maxHeight;
        const auto maxCross = horizontal ? constraints.maxHeight : constraints.maxWidth;
        node.flowLines.clear();
        float lineMain = 0;
        for (auto childId : node.children) {
            const auto& child = tree.node(childId);
            const auto weight = child.modifier.parentData().weight;
            const auto preferred = weight > 0 ? intrinsic(tree, childId, 0, horizontal, false, maxCross) : mainSize(measure(tree, childId, childConstraints(horizontal, 0, maxMain, maxCross)), horizontal);
            if (node.flowLines.empty() || !node.flowLines.back().empty() && (node.flowLines.back().size() >= static_cast<std::size_t>(policy.maxItems) || lineMain + policy.mainArrangement.spacing + preferred > maxMain)) {
                node.flowLines.emplace_back();
                lineMain = 0;
            }
            if (!node.flowLines.back().empty()) lineMain += policy.mainArrangement.spacing;
            node.flowLines.back().push_back(childId);
            lineMain += preferred;
        }
        float contentMain = 0, contentCross = 0;
        for (const auto& line : node.flowLines) {
            const auto gaps = policy.mainArrangement.spacing * (line.size() - 1);
            float fixed = gaps, totalWeight = 0;
            for (auto childId : line) {
                const auto& child = tree.node(childId);
                const auto weight = child.modifier.parentData().weight;
                if (weight > 0)
                    totalWeight += weight;
                else
                    fixed += mainSize(measuredSize(child), horizontal);
            }
            float used = gaps, lineCross = 0;
            for (auto childId : line) {
                auto& child = tree.node(childId);
                const auto data = child.modifier.parentData();
                if (data.weight > 0) {
                    const auto share = std::isfinite(maxMain) ? std::max(0.0f, maxMain - fixed) * data.weight / totalWeight : Constraints::Infinity;
                    measure(tree, childId, childConstraints(horizontal, data.weightFill && std::isfinite(share) ? share : 0, share, maxCross));
                }
                used += mainSize(measuredSize(child), horizontal);
                lineCross = std::max(lineCross, crossSize(measuredSize(child), horizontal));
            }
            contentMain = std::max(contentMain, used);
            contentCross += lineCross;
        }
        if (!node.flowLines.empty()) contentCross += policy.crossArrangement.spacing * (node.flowLines.size() - 1);
        return horizontal ? Size{contentMain, contentCross} : Size{contentCross, contentMain};
    }

    void LayoutEngine::placeFlow(LayoutTree& tree, LayoutNode& node, float x, float y, float width, float height, const FlowMeasurePolicy& policy) {
        const auto horizontal = policy.horizontal;
        const auto availableMain = horizontal ? width : height, availableCross = horizontal ? height : width;
        std::vector<float> lineCross;
        float totalCross = node.flowLines.empty() ? 0 : policy.crossArrangement.spacing * (node.flowLines.size() - 1);
        for (const auto& line : node.flowLines) {
            float size = 0;
            for (auto childId : line) size = std::max(size, crossSize(measuredSize(tree.node(childId)), horizontal));
            lineCross.push_back(size);
            totalCross += size;
        }
        const auto crossPlacement = arrange(availableCross, totalCross, node.flowLines.size(), policy.crossArrangement);
        float crossCursor = crossPlacement.offset;
        for (std::size_t lineIndex = 0; lineIndex < node.flowLines.size(); ++lineIndex) {
            const auto& line = node.flowLines[lineIndex];
            float used = policy.mainArrangement.spacing * (line.size() - 1);
            for (auto childId : line) used += mainSize(measuredSize(tree.node(childId)), horizontal);
            const auto placement = arrange(availableMain, used, line.size(), policy.mainArrangement);
            float mainCursor = placement.offset;
            for (auto childId : line) {
                const auto& child = tree.node(childId);
                const auto ownAlignment = child.modifier.parentData().align;
                const auto crossOffset = crossCursor + align(lineCross[lineIndex], crossSize(measuredSize(child), horizontal), ownAlignment.empty() ? policy.itemAlignment : ownAlignment);
                place(tree, childId, x + (horizontal ? mainCursor : crossOffset), y + (horizontal ? crossOffset : mainCursor));
                mainCursor += mainSize(measuredSize(child), horizontal) + placement.spacing;
            }
            crossCursor += lineCross[lineIndex] + crossPlacement.spacing;
        }
    }
}
