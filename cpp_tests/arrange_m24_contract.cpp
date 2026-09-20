#include <arrange/core/Layout.h>
#include <arrange/core/Paint.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void require(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    PropValue policy(const char* kind) { return PropValue::objectValue({{"kind", PropValue::stringValue(kind)}}); }

    ModifierDescriptor size(float width, float height) {
        LayoutModifierSemantics input;
        input.kind = LayoutModifierKind::Size;
        input.width = width;
        input.height = height;
        return {input};
    }

    void policiesAndStyleless() {
        LayoutTree tree;
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, CreateNodeMutation{2, NodeType::Layout}, CreateNodeMutation{3, NodeType::Layout}, InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}, SetModifierMutation{2, {size(30, 20)}}, SetModifierMutation{3, {size(40, 10)}}});
        LayoutEngine engine;
        tree.setHostInput(1, HostInput::MeasurePolicy, policy("Row"));
        engine.layout(tree, 1, {0, 200, 0, 200});
        require(tree.node(1).bounds.width == 70 && tree.node(1).bounds.height == 20, "RowMeasurePolicy 未按子项测量");
        require(tree.node(3).bounds.x == 30, "RowMeasurePolicy 未按顺序放置");

        tree.setHostInput(1, HostInput::MeasurePolicy, policy("Column"));
        engine.layout(tree, 1, {0, 200, 0, 200});
        require(tree.node(1).bounds.width == 40 && tree.node(1).bounds.height == 30 && tree.node(3).bounds.y == 20, "同一 LayoutNode 切换 ColumnMeasurePolicy 失败");

        tree.setHostInput(1, HostInput::MeasurePolicy, policy("Box"));
        engine.layout(tree, 1, {0, 200, 0, 200});
        require(tree.node(1).bounds.width == 40 && tree.node(1).bounds.height == 20 && tree.node(3).bounds.x == 0 && tree.node(3).bounds.y == 0, "BoxMeasurePolicy 未叠放子项");

        tree.setHostInput(1, HostInput::MeasurePolicy, policy("MinSize"));
        engine.layout(tree, 1, {17, 200, 19, 200});
        require(tree.node(1).bounds.width == 17 && tree.node(1).bounds.height == 19, "MinSizeMeasurePolicy 必须严格采用最小约束");

    }

    void painterModifier() {
        auto content = std::make_shared<PainterContent>();
        content->intrinsicSize = Size{42, 26};
        PaintModifier paint;
        paint.painter = {1, 2, 1, content};
        LayoutTree tree;
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, SetModifierMutation{1, {{paint}}}});
        LayoutEngine engine;
        engine.layout(tree, 1, {0, 200, 0, 200});
        require(tree.node(1).bounds.width == 42 && tree.node(1).bounds.height == 26, "paint Modifier 未将固有尺寸传入最小约束");
        DrawOpsBuilder drawing;
        PaintWorkCounters counters;
        auto ops = exportDrawOps(drawing.build(tree, 1, counters));
        require(ops.size() == 1 && ops.front().type == DrawOpType::DrawPainter && !ops.front().hasTint && ops.front().painter.content == content, "Painter 原色或内容所有权未保留");

        auto tinted = paint;
        tinted.tint = 0xffc04080u;
        require((modifierInvalidation(paint, tinted) & dirtyMask(DirtyFlag::Layout)) == 0, "仅 tint 变化不能重新测量");
        tree.setModifierChain(1, {{tinted}});
        engine.layout(tree, 1, {0, 200, 0, 200});
        ops = exportDrawOps(drawing.build(tree, 1, counters));
        require(ops.front().hasTint && ops.front().color == 0xffc04080u, "显式 tint 未转换为颜色过滤");

        tree.setModifierChain(1, {});
        require(ops.front().painter.content == content, "退休受体不应清空旧帧的成功内容");
    }

    void independentModifierReceivers() {
        LayoutTree tree;
        const ModifierDescriptors description{size(30, 20), {OffsetModifier{2, 3}, "位置"}};
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, CreateNodeMutation{2, NodeType::Layout}, SetModifierMutation{1, description}, SetModifierMutation{2, description}});
        const auto first = tree.node(1).modifier.elements()[1].handle;
        const auto second = tree.node(2).modifier.elements()[1].handle;
        require(first != second, "共享 Modifier 描述的两个受体必须物化独立实例");

        tree.setModifierInput(1, first, OffsetModifier{12, 13});
        const auto& firstValue = std::get<OffsetModifier>(tree.node(1).modifier.elements()[1].descriptor.value);
        const auto& secondValue = std::get<OffsetModifier>(tree.node(2).modifier.elements()[1].descriptor.value);
        require(firstValue.x == 12 && secondValue.x == 2, "一个受体的实例更新不得污染另一个受体");

        bool rejected = false;
        try { tree.setModifierInput(2, first, OffsetModifier{20, 30}); }
        catch (const std::invalid_argument&) { rejected = true; }
        require(rejected, "Modifier 实例不能跨受体更新");
        tree.apply({DeleteNodeMutation{1}});
        tree.setModifierInput(2, second, OffsetModifier{22, 23});
        require(tree.node(2).modifier.elements()[1].handle == second, "退休一个 LayoutNode 不得退休另一个受体的实例");
    }

    void painterRequests() {
        arrange::quickjs::QuickJsScriptHost host;
        std::vector<std::shared_ptr<std::promise<PainterLoadResult>>> requests;
        host.setPainterLoader([&](const std::string&) {
            auto request = std::make_shared<std::promise<PainterLoadResult>>();
            requests.push_back(request);
            return request->get_future();
        });
        const auto started = host.executeModule("m24-painter.js", R"JS(
const native = globalThis.__ARRANGE_NATIVE__
native.createNode(1, 'Root')
native.createNode(2, 'LayoutNode')
native.insertChild(1, 2, 0)
const binding = native.registerBinding(2, 'modifier')
const retired = native.acquirePainter('取消', () => { throw new Error('已取消的 Painter 不得完成') })
native.releasePainter(retired)
const handle = native.acquirePainter('成功', completion => {
    let staleRejected = false
    try { native.updateBinding(binding, { elements: [{ type: 'paint', value: { painter: { ...handle, contentVersion: 0 } } }] }) }
    catch (error) { staleRejected = String(error).includes('内容版本已过期') }
    if (!staleRejected) throw new Error('旧内容版本必须拒绝')
    native.updateBinding(binding, { elements: [{ type: 'paint', value: { painter: { ...handle, contentVersion: completion.contentVersion } } }] })
    native.releasePainter(handle)
    let retiredRejected = false
    try { native.updateBinding(binding, { elements: [{ type: 'paint', value: { painter: { ...handle, contentVersion: completion.contentVersion } } }] }) }
    catch (error) { retiredRejected = String(error).includes('已退休') }
    if (!retiredRejected) throw new Error('已退休的资源身份必须拒绝')
})
)JS");
        require(started.ok, started.error.c_str());
        require(requests.size() == 2 && host.hasPendingAnimationFrame(), "资源请求没有进入 Owner 完成入口");
        auto content = std::make_shared<PainterContent>();
        content->intrinsicSize = Size{18, 12};
        requests[0]->set_value({content, {}});
        requests[1]->set_value({content, {}});
        const auto completed = host.pumpAnimationFrame(16);
        require(completed.ok, completed.error.c_str());
        require(!host.hasPendingAnimationFrame(), "完成或取消后仍有资源工作存活");
        const auto transaction = host.takePendingTransaction();
        require(transaction.has_value(), "Painter 完成没有提交类型化操作");

        const auto waiting = host.executeModule("m24-painter-reset.js", R"JS(
const native = globalThis.__ARRANGE_NATIVE__
native.createNode(1, 'Root')
native.acquirePainter('旧上下文', () => { throw new Error('reset 后不得执行旧回调') })
)JS");
        require(waiting.ok && host.hasPendingAnimationFrame(), "未完成资源请求没有登记");
        const auto reset = host.executeModule("m24-painter-new.js", "globalThis.__ARRANGE_NATIVE__.createNode(1, 'Root')");
        require(reset.ok, reset.error.c_str());
        requests[2]->set_value({content, {}});
        require(!host.hasPendingAnimationFrame(), "reset 后旧资源仍在等待队列");
        require(host.pumpAnimationFrame(32).ok, "reset 后迟到结果执行了旧回调");

        const auto failing = host.executeModule("m24-painter-failure.js", R"JS(
const native = globalThis.__ARRANGE_NATIVE__
native.createNode(1, 'Root')
const handle = native.acquirePainter('失败', completion => {
    if (completion.error !== '解码失败' || completion.contentVersion !== 1) throw new Error('失败完成内容不正确')
    native.releasePainter(handle)
})
)JS");
        require(failing.ok, failing.error.c_str());
        requests[3]->set_exception(std::make_exception_ptr(std::runtime_error("解码失败")));
        const auto failure = host.pumpAnimationFrame(48);
        require(failure.ok, failure.error.c_str());
        require(!host.hasPendingAnimationFrame(), "失败完成后未释放资源请求");

        auto late = std::make_shared<std::promise<PainterLoadResult>>();
        {
            arrange::quickjs::QuickJsScriptHost temporary;
            temporary.setPainterLoader([late](const std::string&) { return late->get_future(); });
            const auto pending = temporary.executeModule("m24-painter-destroy.js", "const n = globalThis.__ARRANGE_NATIVE__; n.createNode(1, 'Root'); n.acquirePainter('销毁', () => { throw new Error('销毁后不得回调') })");
            require(pending.ok && temporary.hasPendingAnimationFrame(), "销毁用例未创建待完成请求");
        }
        late->set_value({content, {}});
    }
}

int main() {
    try {
        policiesAndStyleless();
        painterModifier();
        independentModifierReceivers();
        painterRequests();
        std::cout << "M2.4 原生布局、基础呈现与 Painter 契约通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
