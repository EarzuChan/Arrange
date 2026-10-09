#include <arrange/core/Layout.h>
#include <arrange/core/LazyLayout.h>
#include <arrange/core/SceneFramePipeline.h>

#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <unordered_map>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    bool near(float a, float b) {
        return std::abs(a - b) < 0.01f;
    }

    struct Fixture {
        LayoutTree tree;
        LayoutEngine layout;
        LazyMeasurePolicy policy;
        std::vector<float> heights;
        std::unordered_map<int, NodeId> active;
        NodeId nextId = 2;

        explicit Fixture(int count, float height) : heights(count, height) {
            tree.apply({CreateNodeMutation{1, NodeType::Layout}});
            std::vector<std::string> keys;
            for (int index = 0; index < count; ++index) keys.push_back("key:" + std::to_string(index));
            dataset(std::move(keys));
            LayoutModifierSemantics scroll;
            scroll.kind = LayoutModifierKind::VerticalScroll;
            tree.setModifierChain(1, {{scroll}});
            layout.setMaterializer([&](NodeId id, const std::vector<int>& indices) {
                check(id == 1, "材料化驱动收到错误 Layout");
                std::unordered_map<int, NodeId> selected;
                for (int index : indices) {
                    const auto previous = active.find(index);
                    const auto child = previous == active.end() ? nextId++ : previous->second;
                    if (previous == active.end()) tree.apply({CreateNodeMutation{child, NodeType::Layout}});
                    selected[index] = child;
                }
                for (const auto& [index, child] : active)
                    if (!selected.contains(index)) tree.apply({RemoveChildMutation{1, child}, DeleteNodeMutation{child}});
                for (std::size_t position = 0; position < indices.size(); ++position) {
                    const auto index = indices[position];
                    const auto child = selected[index];
                    tree.apply({InsertChildMutation{1, child, static_cast<std::uint32_t>(position)}});
                    setHeight(index, child);
                }
                active = std::move(selected);
                policy.indices = indices;
                tree.node(1).measurePolicy = policy;
            });
        }

        void dataset(std::vector<std::string> keys) {
            policy.keys = std::move(keys);
            policy.contentTypes = std::vector<std::string>(policy.keys.size());
            policy.spans = std::vector<int>(policy.keys.size(), 1);
            ++policy.version;
        }

        void setHeight(int index, NodeId child) {
            LayoutModifierSemantics size;
            size.kind = LayoutModifierKind::Size;
            size.width = 18;
            size.height = heights[index];
            tree.setModifierChain(child, {{size}});
        }

        void scrollTo(float value) {
            auto scroll = std::get<LayoutModifierSemantics>(tree.node(1).modifier.elements()[0].descriptor.value);
            scroll.scrollValue = value;
            tree.setModifierChain(1, {{scroll}});
        }

        void frame(float viewport = 100, float cross = 100) {
            for (const auto& [index, child] : active)
                if (index < heights.size()) setHeight(index, child);
            ++policy.workVersion;
            tree.node(1).measurePolicy = policy;
            tree.node(1).measurementValid = false;
            markDirty(tree.node(1), DirtyFlag::Layout);
            layout.layout(tree, 1, {0, cross, 0, viewport});
            policy = std::get<LazyMeasurePolicy>(tree.node(1).measurePolicy);
            tree.clearDirty();
        }

        void settle(float viewport = 100, float cross = 100) {
            for (int frameIndex = 0; frameIndex < 100; ++frameIndex) {
                frame(viewport, cross);
                if (!state().snapshot.needsMoreItems) return;
            }
            throw std::runtime_error("有限预取未能稳定");
        }

        const LazyLayoutState& state() const {
            return *tree.node(1).lazy;
        }
    };

    void activeGeometryAndCow() {
        Fixture fixture(5000, 1);
        fixture.frame(1200);
        const auto& state = fixture.state();
        check(state.snapshot.visibleItems.size() == 1200 && state.snapshot.firstVisibleItemIndex == 0, "1200个可见项被1024离屏LRU破坏");
        check(state.measurements.size() >= 1200 && state.lineMainSizes[0] == 1 && state.lineMainSizes[1199] == 1, "活动几何未独立留存");
        auto candidate = state;
        check(candidate.keys.values().data() == state.keys.values().data() && candidate.lines.values().data() == state.lines.values().data(), "Lazy候选深拷贝了不可变数据集索引");
        candidate.itemMainSizes.set(0, 99);
        candidate.lineMainSizes.set(0, 99);
        candidate.prefixDeltas.add(1, 98);
        check(state.itemMainSizes[0] == 1 && state.lineMainSizes[0] == 1 && candidate.itemMainSizes[0] == 99, "几何分块COW污染已发布状态");
        fixture.policy.requestedIndex = 3000;
        ++fixture.policy.requestVersion;
        fixture.frame(100);
        check(fixture.state().snapshot.visibleItems.size() == 100 && fixture.state().snapshot.firstVisibleItemIndex == 3000, "大跳转未保持完整可见几何");
        check(fixture.state().measurements.size() <= fixture.policy.indices.size() + 1024 && !fixture.state().measurements.contains("key:0") && fixture.state().itemMainSizes[0] == 1 && fixture.state().lineMainSizes[0] == 1, "离屏LRU超过1024或淘汰了几何索引账本");
    }

    void zeroProgress() {
        Fixture fixture(201, 0);
        fixture.heights.back() = 20;
        int known = 0;
        for (int frameIndex = 0; frameIndex < 8; ++frameIndex) {
            fixture.frame();
            int current = 0;
            for (int index = 0; index < 200; ++index)
                if (fixture.state().itemMainSizes[index] == 0) ++current;
            check(current - known <= 64 && current > known || current == 200, "零项未按每帧64项预算提交进度");
            known = current;
            if (!fixture.state().snapshot.needsMoreItems) break;
        }
        check(known == 200 && !fixture.state().snapshot.needsMoreItems && fixture.state().snapshot.visibleItems.size() == 1 && fixture.state().snapshot.visibleItems.front().index == 200, "长串空项永远失败或挡住后续可见项");
    }

    void compatibleCacheAndAnchor() {
        Fixture fixture(20, 10);
        fixture.settle(50);
        fixture.policy.mainSpacing = 5;
        fixture.frame(50);
        check(fixture.state().lineMainSizes[0] == 10, "兼容cache重建把完整小line恢复成estimate");
        fixture.policy.mainSpacing = 0;
        fixture.settle(50);
        const auto cacheHits = fixture.state().measurementCacheHits;
        auto keys = fixture.policy.keys.values();
        keys.erase(keys.begin());
        fixture.heights.erase(fixture.heights.begin());
        fixture.dataset(keys);
        fixture.frame(50);
        keys.insert(keys.begin(), "key:0");
        fixture.heights.insert(fixture.heights.begin(), 10);
        fixture.dataset(keys);
        fixture.frame(50);
        check(fixture.state().measurementCacheHits > cacheHits, "按key/type/约束的离屏富cache没有实际复用");
        fixture.scrollTo(100);
        fixture.settle(50);
        check(fixture.state().snapshot.firstVisibleItemIndex == 10, "锚点测试未到初始项");
        keys = fixture.policy.keys.values();
        keys.insert(keys.begin(), "new");
        fixture.heights.insert(fixture.heights.begin(), 10);
        fixture.dataset(keys);
        fixture.scrollTo(120);
        fixture.frame(50);
        check(fixture.state().snapshot.firstVisibleItemIndex == 13 && near(fixture.state().snapshot.firstVisibleItemScrollOffset, 0), "key重排锚点吞掉了同帧滚动delta");
    }

    void gridPaddingAndArrangement() {
        Fixture fixture(3, 10);
        fixture.policy.grid = true;
        fixture.policy.cells = 2;
        fixture.policy.crossBeforePadding = 10;
        fixture.policy.crossAfterPadding = 20;
        fixture.policy.crossSpacing = 10;
        fixture.policy.mainAlignment = "Center";
        fixture.policy.spans = std::vector<int>{1, 1, -1};
        fixture.settle();
        const auto& first = fixture.tree.node(fixture.active.at(0));
        const auto& second = fixture.tree.node(fixture.active.at(1));
        const auto& spanning = fixture.tree.node(fixture.active.at(2));
        check(first.bounds == Rect{10, 40, 30, 10} && second.bounds == Rect{50, 40, 30, 10} && spanning.bounds == Rect{10, 50, 70, 10}, "grid padding/span/少量内容主轴Center错误");
        fixture.policy.mainAlignment = "SpaceBetween";
        fixture.frame();
        check(fixture.tree.node(fixture.active.at(0)).bounds.y == 0 && fixture.tree.node(fixture.active.at(2)).bounds.y == 90, "Lazy主轴SpaceBetween未消费余量");
        fixture.policy.adaptiveMinSize = 35;
        fixture.frame();
        check(fixture.state().cells == 1, "Adaptive cells未扣除交叉轴padding");

        Fixture cached(100, 10);
        cached.policy.grid = true;
        cached.policy.cells = 2;
        cached.policy.crossSpacing = 10;
        cached.settle(20);
        cached.policy.requestedIndex = 80;
        ++cached.policy.requestVersion;
        cached.settle(20);
        cached.policy.crossSpacing = 20;
        cached.frame(20);
        check(cached.state().itemMainSizes[0] < 0 && cached.state().measurements.at("key:0").crossConstraint == 45, "grid交叉间距变更继续使用旧宽度的离屏几何");
    }

    void materializationGuard() {
        for (int scenario = 0; scenario < 6; ++scenario) {
            NativeScene scene;
            MutationTransaction initial;
            LayoutModifierSemantics size;
            size.kind = LayoutModifierKind::Size;
            size.width = size.height = 100;
            LayoutModifierSemantics scroll;
            scroll.kind = LayoutModifierKind::VerticalScroll;
            initial.operations = {TreeMutation{CreateNodeMutation{1, NodeType::Root}}, TreeMutation{CreateNodeMutation{2, NodeType::Layout}}, TreeMutation{CreateNodeMutation{4, NodeType::Layout}}, TreeMutation{SetModifierMutation{1, {{size}}}}, TreeMutation{SetModifierMutation{2, {{size}, {scroll}}}}, TreeMutation{InsertChildMutation{1, 2, 0}}, TreeMutation{InsertChildMutation{1, 4, 1}}};
            scene.apply(initial);
            LazyMeasurePolicy policy;
            policy.mainAlignment = "Top";
            policy.keys = std::vector<std::string>{"guard"};
            policy.contentTypes = std::vector<std::string>{""};
            policy.spans = std::vector<int>{1};
            scene.node(2).measurePolicy = policy;
            const BindingHandle ancestorBinding{allocateRuntimeIdentity(), allocateRuntimeIdentity()};
            MutationTransaction registration;
            registration.operations.push_back(RegisterBinding{ancestorBinding, ModifierChainTarget{{1, scene.node(1).generation}}});
            scene.apply(registration);
            SceneFramePipeline pipeline;
            PublishedFrame published;
            FramePreparation preparation;
            preparation.materialize = [&](NodeId layout, const std::vector<int>& indices) {
                check(layout == 2 && indices == std::vector<int>{0}, "guard夹具请求错误");
                MutationTransaction result;
                size.width = 20;
                size.height = 10;
                result.operations = {TreeMutation{CreateNodeMutation{3, NodeType::Layout}}, TreeMutation{SetModifierMutation{3, {{size}}}}, TreeMutation{InsertChildMutation{2, 3, 0}}, TreeMutation{SetPropMutation{2, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Lazy")}, {"version", PropValue::numberValue(1)}, {"indices", PropValue::arrayValue({PropValue::numberValue(0)})}, {"pinnedIndices", PropValue::arrayValue({})}})}}};
                if (scenario == 0)
                    result.operations.push_back(TreeMutation{SetModifierMutation{1, {{size}}}});
                else if (scenario == 1)
                    result.operations.push_back(SlotUpdate{ancestorBinding, ModifierDescriptors{{size}}});
                else if (scenario == 2)
                    result.operations.push_back(TreeMutation{SetModifierMutation{2, {{size}}}});
                else if (scenario == 3)
                    result.operations.push_back(TreeMutation{DeleteNodeMutation{4}});
                else if (scenario == 4) {
                    auto& changed = std::get<SetPropMutation>(std::get<TreeMutation>(result.operations.back())).value;
                    changed.fields.push_back({"estimate", PropValue::numberValue(49)});
                }
                return result;
            };
            const auto result = pipeline.run(scene, 1, {0, 100, 0, 100}, nullptr, true, published, {}, 0, preparation);
            if (scenario < 5)
                check(result.error && result.error->find("测量期物化") != std::string::npos && published.revision == 0 && scene.tree().size() == 3 && !scene.contains(3) && scene.node(1).modifier.elements()[0].measured == Size{}, "物化越界操作未在应用前拒绝并保留发布状态");
            else
                check(!result.error && published.revision == 1 && scene.contains(3) && scene.node(2).children == std::vector<NodeId>{3}, "合法内容子树物化被guard拒绝");
        }
    }

    void adaptiveNumericBoundary() {
        Fixture tiny(3, 10);
        tiny.policy.grid = true;
        tiny.policy.adaptiveMinSize = std::numeric_limits<float>::denorm_min();
        tiny.settle();
        check(tiny.state().cells == 4096, "Adaptive 极小 minSize 在转整数前没有夹到单元保护上限");

        Fixture huge(3, 10);
        huge.policy.grid = true;
        huge.policy.adaptiveMinSize = std::numeric_limits<float>::max();
        huge.policy.crossSpacing = std::numeric_limits<float>::max();
        huge.settle();
        check(huge.state().cells == 1, "Adaptive 极大 spacing/minSize 加法产生了 NaN 单元数");
    }

    void numericBoundary() {
        const auto policy = PropValue::objectValue({{"kind", PropValue::stringValue("Lazy")}, {"keys", PropValue::arrayValue({})}, {"contentTypes", PropValue::arrayValue({})}, {"spans", PropValue::arrayValue({})}, {"indices", PropValue::arrayValue({})}, {"pinnedIndices", PropValue::arrayValue({})}});
        for (const auto* field : {"adaptiveMinSize", "mainSpacing", "crossSpacing", "beforePadding", "afterPadding", "crossBeforePadding", "crossAfterPadding", "estimate", "requestedOffset"}) {
            auto overflow = policy;
            overflow.fields.push_back({field, PropValue::numberValue(1e100)});
            bool rejected = false;
            try {
                (void)readMeasurePolicy(overflow);
            } catch (const std::invalid_argument&) {
                rejected = true;
            }
            check(rejected, "Lazy 接收了无法表示为有限 float 的 PX 几何数值");
        }
    }
}

int main() {
    const char* step = "1200可见项/COW";
    try {
        activeGeometryAndCow();
        step = "零项有限进展";
        zeroProgress();
        step = "cache兼容/key锚点";
        compatibleCacheAndAnchor();
        step = "网格padding/span/排列";
        gridPaddingAndArrangement();
        step = "测量期物化范围/原子性";
        materializationGuard();
        step = "Lazy PX 数值边界";
        numericBoundary();
        step = "Adaptive 算术边界";
        adaptiveNumericBoundary();
        std::cout << "M3 Lazy 几何、COW、LRU、零项进度、锚点与网格通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << step << "：" << error.what() << '\n';
        return 1;
    }
}
