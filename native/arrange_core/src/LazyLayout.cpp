#include <arrange/core/Layout.h>
#include <arrange/core/LazyLayout.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <unordered_set>

namespace arrange::core {
    namespace {
        constexpr std::size_t MeasurementBudget = 1024;
        constexpr std::size_t MaterializationBudget = 4096;
        constexpr std::size_t UnknownBatchBudget = 64;
        constexpr std::size_t ZeroItemBudget = 64;
        constexpr std::size_t PrefetchBudget = 4;
        constexpr int PreparationPassBudget = MaterializationBudget;

        struct FrameWork {
            std::unordered_set<int> retained, materialized, prefetched;
            std::unordered_map<int, NodeId> measured;
            std::size_t zeroItems = 0;
        };

        struct Selection {
            std::vector<int> indices;
            bool pendingVisible = false, pendingPrefetch = false;
        };

        struct MainPlacement {
            float offset = 0, extraSpacing = 0;
        };

        float deltaBefore(const LazyLayoutState& state, int line) {
            float result = 0;
            for (auto cursor = static_cast<std::size_t>(line); cursor > 0; cursor -= cursor & -cursor) result += state.prefixDeltas[cursor];
            return result;
        }

        float lineSize(const LazyLayoutState& state, int line) {
            return state.lineMainSizes[line];
        }

        void setLineSize(LazyLayoutState& state, int line, float value) {
            const auto previous = lineSize(state, line);
            if (value == previous) return;
            state.lineMainSizes.set(line, value);
            for (auto cursor = static_cast<std::size_t>(line + 1); cursor < state.prefixDeltas.size(); cursor += cursor & -cursor) state.prefixDeltas.add(cursor, value - previous);
        }

        float lineStart(const LazyLayoutState& state, int line, float padding) {
            return padding + (state.estimate + state.spacing) * line + deltaBefore(state, line);
        }

        float totalSize(const LazyLayoutState& state, const LazyMeasurePolicy& policy) {
            const auto count = static_cast<int>(state.lines.size());
            return policy.beforePadding + policy.afterPadding + (count ? count * (state.estimate + state.spacing) - state.spacing + deltaBefore(state, count) : 0);
        }

        int lineAt(const LazyLayoutState& state, float offset, float padding) {
            int low = 0, high = static_cast<int>(state.lines.size());
            while (low < high) {
                const int mid = low + (high - low) / 2;
                if (lineStart(state, mid, padding) + lineSize(state, mid) <= offset)
                    low = mid + 1;
                else
                    high = mid;
            }
            return std::min(low, std::max(0, static_cast<int>(state.lines.size()) - 1));
        }

        float itemCrossConstraint(const LazyLayoutState& state, int index) {
            const auto slot = std::max(0.0f, (state.crossSize - state.crossSpacing * (state.cells - 1)) / state.cells);
            return slot * state.itemSpans[index] + state.crossSpacing * (state.itemSpans[index] - 1);
        }

        void recomputeLine(LazyLayoutState& state, int line) {
            float size = 0;
            bool complete = true;
            for (int item : state.lines[line]) {
                const auto main = state.itemMainSizes[item];
                if (main < 0)
                    complete = false;
                else
                    size = std::max(size, main);
            }
            setLineSize(state, line, complete ? size : std::max(size, state.estimate));
        }

        void rebuild(LazyLayoutState& state, const LazyMeasurePolicy& policy, int cells, float cross) {
            const bool compatible = state.crossSize == cross && state.cells == cells && state.crossSpacing == policy.crossSpacing;
            const auto oldTypes = state.contentTypes;
            const auto oldIndex = state.keyToIndex;
            const auto oldSpans = state.itemSpans;
            const auto oldSizes = state.itemMainSizes;
            std::vector<int> itemLines(policy.keys.size()), itemSlots(policy.keys.size()), itemSpans(policy.keys.size());
            std::vector<std::vector<int>> lines;
            LazyKeyIndex::Values indices;
            indices.reserve(policy.keys.size());
            int slot = 0;
            for (int index = 0; index < policy.keys.size(); ++index) {
                const auto span = policy.grid ? policy.spans[index] < 0 ? cells : std::min(cells, policy.spans[index]) : 1;
                if (lines.empty() || slot + span > cells) {
                    lines.emplace_back();
                    slot = 0;
                }
                itemLines[index] = static_cast<int>(lines.size()) - 1;
                itemSlots[index] = slot;
                itemSpans[index] = span;
                lines.back().push_back(index);
                indices.emplace(policy.keys[index], index);
                slot += span;
            }
            state.keys = policy.keys;
            state.contentTypes = policy.contentTypes;
            state.keyToIndex = std::move(indices);
            state.itemLines = std::move(itemLines);
            state.itemSlots = std::move(itemSlots);
            state.itemSpans = std::move(itemSpans);
            state.lines = std::move(lines);
            state.cells = cells;
            state.crossSize = cross;
            state.crossSpacing = policy.crossSpacing;
            state.version = policy.version;
            state.estimate = policy.estimate;
            state.spacing = policy.mainSpacing;
            state.itemMainSizes.assign(policy.keys.size(), -1);
            state.lineMainSizes.assign(state.lines.size(), state.estimate);
            state.prefixDeltas.assign(state.lines.size() + 1, 0);
            for (int index = 0; index < policy.keys.size(); ++index) {
                const auto previous = oldIndex.find(policy.keys[index]);
                if (compatible && previous != oldIndex.end() && oldSpans[previous->second] == state.itemSpans[index] && oldTypes[previous->second] == policy.contentTypes[index]) state.itemMainSizes.set(index, oldSizes[previous->second]);
                const auto cached = state.measurements.find(policy.keys[index]);
                if (cached == state.measurements.end()) continue;
                auto& measured = cached->second;
                if (measured.contentType == policy.contentTypes[index] && measured.crossConstraint == itemCrossConstraint(state, index)) {
                    if (state.itemMainSizes[index] < 0) {
                        state.itemMainSizes.set(index, measured.main);
                        ++state.measurementCacheHits;
                    }
                    measured.line = state.itemLines[index];
                }
            }
            for (int line = 0; line < state.lines.size(); ++line) recomputeLine(state, line);
        }

        void updateMeasurement(LazyLayoutState& state, const LazyMeasurePolicy& policy, int index, float main) {
            const auto line = state.itemLines[index];
            state.itemMainSizes.set(index, main);
            state.measurements[policy.keys[index]] = {main, policy.contentTypes[index], ++state.clock, line, itemCrossConstraint(state, index)};
            recomputeLine(state, line);
        }

        void trimMeasurements(LazyLayoutState& state, const LazyMeasurePolicy& policy) {
            std::unordered_set<std::string> active;
            for (int index : policy.indices) active.insert(policy.keys[index]);
            std::vector<decltype(state.measurements)::iterator> inactive;
            for (auto item = state.measurements.begin(); item != state.measurements.end(); ++item)
                if (!active.contains(item->first)) inactive.push_back(item);
            if (inactive.size() <= MeasurementBudget) return;
            std::sort(inactive.begin(), inactive.end(), [](const auto& a, const auto& b) { return a->second.used < b->second.used; });
            for (std::size_t index = 0; index < inactive.size() - MeasurementBudget; ++index) state.measurements.erase(inactive[index]);
        }

        std::unordered_set<int> pins(const LazyLayoutState& state, const LazyMeasurePolicy& policy) {
            std::unordered_set<int> result(policy.pinnedIndices.begin(), policy.pinnedIndices.end());
            for (const auto& key : state.pinnedKeys) {
                const auto found = state.keyToIndex.find(key);
                if (found != state.keyToIndex.end()) result.insert(found->second);
            }
            const auto requested = state.keyToIndex.find(state.focusRequestKey);
            if (requested != state.keyToIndex.end()) result.insert(requested->second);
            return result;
        }

        Selection range(const LazyLayoutState& state, const LazyMeasurePolicy& policy, float offset, float viewport, FrameWork& work) {
            Selection result;
            const auto pinned = pins(state, policy);
            std::unordered_set<int> selected;
            std::size_t fresh = 0;
            const auto add = [&](int index) {
                if (selected.insert(index).second) {
                    if (selected.size() > MaterializationBudget) throw std::runtime_error("Lazy 可见或固定项超过 4096 项保护上限，请为项提供合理尺寸");
                    result.indices.push_back(index);
                    if (!work.materialized.contains(index)) ++fresh;
                }
            };
            for (int index : pinned) add(index);
            if (!state.lines.empty() && viewport > 0) {
                const auto first = lineAt(state, offset, policy.beforePadding);
                const auto visibleEnd = offset + viewport;
                for (int line = first; line < state.lines.size(); ++line) {
                    if (lineStart(state, line, policy.beforePadding) >= visibleEnd) break;
                    bool stopped = false;
                    for (int index : state.lines[line]) {
                        if (!work.materialized.contains(index) && fresh >= UnknownBatchBudget && !selected.contains(index)) {
                            result.pendingVisible = true;
                            stopped = true;
                            break;
                        }
                        add(index);
                    }
                    if (stopped) break;
                }
                const auto windowStart = std::max(0.0f, offset - viewport * 0.5f), windowEnd = offset + viewport * 2;
                const auto inWindow = [&](int index) {
                    const auto line = state.itemLines[index];
                    const auto start = lineStart(state, line, policy.beforePadding);
                    return start < windowEnd && start + lineSize(state, line) > windowStart;
                };
                for (int index : work.retained)
                    if (index < policy.keys.size() && inWindow(index) && selected.size() < MaterializationBudget) add(index);
                for (int index : work.prefetched)
                    if (index < policy.keys.size() && inWindow(index) && selected.size() < MaterializationBudget) add(index);
                const auto prefetchLine = [&](int line) {
                    for (int index : state.lines[line]) {
                        if (selected.contains(index)) continue;
                        if (selected.size() >= MaterializationBudget) continue;
                        if (work.prefetched.size() >= PrefetchBudget || fresh >= UnknownBatchBudget) {
                            result.pendingPrefetch = true;
                            continue;
                        }
                        work.prefetched.insert(index);
                        add(index);
                    }
                };
                if (!result.pendingVisible) {
                    for (int line = first; line < state.lines.size() && lineStart(state, line, policy.beforePadding) < windowEnd; ++line) prefetchLine(line);
                    const auto behind = lineAt(state, windowStart, policy.beforePadding);
                    for (int line = first - 1; line >= behind; --line) prefetchLine(line);
                }
            }
            std::sort(result.indices.begin(), result.indices.end());
            return result;
        }

        float alignmentOffset(float parent, float child, const std::string& alignment) {
            if (alignment == "CenterHorizontally" || alignment == "CenterVertically" || alignment == "Center") return (parent - child) / 2;
            if (alignment == "End" || alignment == "Bottom") return parent - child;
            return 0;
        }

        MainPlacement mainPlacement(const LazyLayoutState& state, const LazyMeasurePolicy& policy) {
            MainPlacement result;
            const auto extra = std::max(0.0f, state.viewportSize - state.contentSize);
            const auto count = state.lines.size();
            if (policy.mainAlignment == "Center" || policy.mainAlignment == "CenterHorizontally" || policy.mainAlignment == "CenterVertically")
                result.offset = extra / 2;
            else if (policy.mainAlignment == "End" || policy.mainAlignment == "Bottom")
                result.offset = extra;
            else if (policy.mainAlignment == "SpaceBetween" && count > 1)
                result.extraSpacing = extra / (count - 1);
            else if (policy.mainAlignment == "SpaceAround" && count) {
                result.extraSpacing = extra / count;
                result.offset = result.extraSpacing / 2;
            } else if (policy.mainAlignment == "SpaceEvenly" && count) {
                result.extraSpacing = extra / (count + 1);
                result.offset = result.extraSpacing;
            }
            return result;
        }
    }

    Size LayoutEngine::measureLazy(LayoutTree& tree, LayoutNode& node, Constraints constraints, LazyMeasurePolicy policy) {
        const auto viewport = policy.horizontal ? constraints.maxWidth : constraints.maxHeight;
        const auto outerCross = policy.horizontal ? constraints.maxHeight : constraints.maxWidth;
        if (!std::isfinite(viewport) || !std::isfinite(outerCross)) throw std::invalid_argument("Lazy 需要两轴有界约束，不能放入同轴滚动或查询完整内容固有尺寸");
        const auto cross = std::max(0.0f, outerCross - policy.crossBeforePadding - policy.crossAfterPadding);
        if (!node.lazy)
            node.lazy = std::make_shared<LazyLayoutState>();
        else if (node.lazy.use_count() != 1)
            node.lazy = std::make_shared<LazyLayoutState>(*node.lazy);
        auto& state = *node.lazy;
        int cells = policy.grid ? policy.cells : 1;
        if (policy.grid && policy.adaptiveMinSize > 0) {
            const auto ratio = (static_cast<double>(cross) + policy.crossSpacing) / (static_cast<double>(policy.adaptiveMinSize) + policy.crossSpacing);
            cells = static_cast<int>(std::clamp(ratio, 1.0, static_cast<double>(MaterializationBudget)));
        }
        cells = std::min(cells, static_cast<int>(MaterializationBudget));
        const auto oldAnchor = state.anchorKey;
        const auto oldAnchorOffset = state.anchorOffset;
        const auto oldOffset = state.scrollOffset;
        const auto changed = state.version != policy.version || state.cells != cells || state.crossSize != cross || state.crossSpacing != policy.crossSpacing || state.estimate != policy.estimate || state.spacing != policy.mainSpacing;
        if (changed) rebuild(state, policy, cells, cross);
        float offset = 0;
        for (const auto& instance : node.modifier.elements()) {
            const auto* scroll = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value);
            if (scroll && scroll->kind == (policy.horizontal ? LayoutModifierKind::HorizontalScroll : LayoutModifierKind::VerticalScroll)) offset = scroll->scrollValue;
        }
        if (changed && !oldAnchor.empty()) {
            const auto found = state.keyToIndex.find(oldAnchor);
            if (found != state.keyToIndex.end()) offset = lineStart(state, state.itemLines[found->second], policy.beforePadding) + oldAnchorOffset + offset - oldOffset;
        }
        const auto requested = state.requestVersion != policy.requestVersion;
        state.requestVersion = policy.requestVersion;
        if (requested && !policy.keys.empty()) {
            const auto index = std::clamp(policy.requestedIndex, 0, static_cast<int>(policy.keys.size()) - 1);
            offset = lineStart(state, state.itemLines[index], policy.beforePadding) + policy.requestedOffset;
        }
        if (state.focusRequestVersion != state.consumedFocusRequestVersion) {
            const auto found = state.keyToIndex.find(state.focusRequestKey);
            if (found != state.keyToIndex.end()) {
                const auto line = state.itemLines[found->second];
                const auto start = lineStart(state, line, policy.beforePadding);
                const auto end = start + lineSize(state, line);
                if (start < offset)
                    offset = start;
                else if (end > offset + viewport)
                    offset = end - viewport;
                state.consumedFocusRequestVersion = state.focusRequestVersion;
            }
        }
        FrameWork work;
        work.retained.insert(policy.indices.begin(), policy.indices.end());
        work.materialized = work.retained;
        bool pending = false;
        const auto materialize = [&](const std::vector<int>& wanted) {
            if (policy.indices == wanted) return;
            if (!materializer_) throw std::runtime_error("Lazy 缺少 Layout 受控子组合驱动");
            materializer_(node.id, wanted);
            const auto* updated = std::get_if<LazyMeasurePolicy>(&tree.node(node.id).measurePolicy);
            if (!updated || updated->version != policy.version || updated->indices != wanted) throw std::runtime_error("Lazy 子组合未交付当前请求的材料化范围");
            policy = *updated;
            work.materialized.insert(wanted.begin(), wanted.end());
        };
        for (int pass = 0;; ++pass) {
            if (pass >= PreparationPassBudget) throw std::runtime_error("Lazy 材料化未能在有限轮数内稳定：范围 " + std::to_string(policy.indices.size()) + "，本帧物化 " + std::to_string(work.materialized.size()) + "，零项 " + std::to_string(work.zeroItems) + "，集合 " + std::to_string(policy.keys.size()));
            state.contentSize = totalSize(state, policy);
            offset = std::clamp(offset, 0.0f, std::max(0.0f, state.contentSize - viewport));
            const auto wanted = range(state, policy, offset, viewport, work);
            materialize(wanted.indices);
            if (node.children.size() != policy.indices.size()) throw std::runtime_error("Lazy 每项必须通过普通 Layout 包装为一个测量根");
            const auto anchorLine = state.lines.empty() ? 0 : lineAt(state, offset, policy.beforePadding);
            const auto previousStart = state.lines.empty() ? 0 : lineStart(state, anchorLine, policy.beforePadding);
            const auto pinned = pins(state, policy);
            auto order = policy.indices;
            std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return pinned.contains(a) && !pinned.contains(b); });
            bool limited = false;
            for (int index : order) {
                const auto position = static_cast<std::size_t>(std::lower_bound(policy.indices.begin(), policy.indices.end(), index) - policy.indices.begin());
                const auto childId = node.children[position];
                const auto previous = work.measured.find(index);
                if (previous != work.measured.end() && previous->second == childId) continue;
                const auto unknown = state.itemMainSizes[index] < 0;
                if (unknown && work.zeroItems >= ZeroItemBudget && !pinned.contains(index)) {
                    limited = true;
                    continue;
                }
                const auto itemCross = itemCrossConstraint(state, index);
                const auto child = measure(tree, childId, policy.horizontal ? Constraints{0, Constraints::Infinity, policy.grid ? itemCross : 0, itemCross} : Constraints{policy.grid ? itemCross : 0, itemCross, 0, Constraints::Infinity});
                const auto main = policy.horizontal ? child.width : child.height;
                work.measured[index] = childId;
                if (unknown && main == 0) ++work.zeroItems;
                updateMeasurement(state, policy, index, main);
            }
            if (limited) {
                std::vector<int> measured;
                for (int index : policy.indices)
                    if (work.measured.contains(index)) measured.push_back(index);
                materialize(measured);
                pending = true;
            }
            if (!state.lines.empty()) offset += lineStart(state, anchorLine, policy.beforePadding) - previousStart;
            state.contentSize = totalSize(state, policy);
            offset = std::clamp(offset, 0.0f, std::max(0.0f, state.contentSize - viewport));
            if (limited) break;
            const auto next = range(state, policy, offset, viewport, work);
            if (next.indices == policy.indices) {
                pending = next.pendingVisible || next.pendingPrefetch;
                break;
            }
            if (work.zeroItems >= ZeroItemBudget) {
                pending = true;
                break;
            }
        }
        trimMeasurements(state, policy);
        state.viewportSize = viewport;
        state.scrollOffset = offset;
        state.snapshot = {};
        state.snapshot.totalItemsCount = static_cast<int>(policy.keys.size());
        state.snapshot.needsMoreItems = pending;
        state.snapshot.workGeneration = ++state.workGeneration;
        const auto placement = mainPlacement(state, policy);
        for (std::size_t position = 0; position < policy.indices.size(); ++position) {
            const auto index = policy.indices[position], line = state.itemLines[index];
            const auto start = lineStart(state, line, policy.beforePadding) + placement.offset + placement.extraSpacing * line - offset;
            const auto& child = tree.node(node.children[position]);
            const auto main = policy.horizontal ? child.bounds.width : child.bounds.height;
            if (start + main > 0 && start < viewport) state.snapshot.visibleItems.push_back({index, start, main, state.itemSpans[index]});
        }
        if (!state.snapshot.visibleItems.empty()) {
            const auto& first = state.snapshot.visibleItems.front();
            state.snapshot.firstVisibleItemIndex = first.index;
            state.snapshot.firstVisibleItemScrollOffset = std::max(0.0f, -first.offset);
            state.anchorKey = policy.keys[first.index];
            state.anchorOffset = state.snapshot.firstVisibleItemScrollOffset;
        } else {
            state.anchorKey.clear();
            state.anchorOffset = 0;
        }
        return policy.horizontal ? Size{viewport, outerCross} : Size{outerCross, viewport};
    }

    void LayoutEngine::placeLazy(LayoutTree& tree, LayoutNode& node, float x, float y, float, float, const LazyMeasurePolicy& policy) {
        if (!node.lazy) return;
        const auto& state = *node.lazy;
        const auto placement = mainPlacement(state, policy);
        for (std::size_t position = 0; position < policy.indices.size(); ++position) {
            const auto index = policy.indices[position], line = state.itemLines[index];
            auto& child = tree.node(node.children[position]);
            const auto itemCross = itemCrossConstraint(state, index);
            const auto slot = std::max(0.0f, (state.crossSize - state.crossSpacing * (state.cells - 1)) / state.cells);
            const auto crossStart = policy.crossBeforePadding + (policy.grid ? (slot + policy.crossSpacing) * state.itemSlots[index] : alignmentOffset(itemCross, policy.horizontal ? child.bounds.height : child.bounds.width, policy.itemAlignment));
            const auto mainStart = lineStart(state, line, policy.beforePadding) + placement.offset + placement.extraSpacing * line;
            place(tree, child.id, x + (policy.horizontal ? mainStart : crossStart), y + (policy.horizontal ? crossStart : mainStart));
        }
    }
}
