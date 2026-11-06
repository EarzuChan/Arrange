#include <arrange/core/DiagnosticsOverlay.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <cstdio>
#include <string>
#include <utility>

namespace arrange::core {
    namespace {
        constexpr std::size_t maxFlashes = 64;
        constexpr float panelX = 8;
        constexpr float panelY = 8;
        constexpr float panelWidth = 220;
        constexpr float padding = 6;
        constexpr float graphHeight = 40;
        constexpr float lineHeight = 14;
        // 图表纵轴满格对应两帧预算
        constexpr double graphMillis = 1000.0 / 30.0;
        constexpr double budgetMillis = 1000.0 / 60.0;

        DrawOp fill(Rect rect, std::uint32_t color, float radius = 0) {
            DrawOp op;
            op.type = DrawOpType::FillRect;
            op.rect = rect;
            op.color = color;
            if (radius > 0) {
                op.shape = DrawShapeType::Rounded;
                op.corners = CornerRadii::uniform(radius);
            }
            return op;
        }

        DrawOp stroke(Rect rect, std::uint32_t color, float width) {
            DrawOp op;
            op.type = DrawOpType::StrokeRect;
            op.rect = rect;
            op.color = color;
            op.strokeWidth = width;
            return op;
        }

        DrawOp text(Rect rect, std::string value, std::uint32_t color) {
            DrawOp op;
            op.type = DrawOpType::DrawText;
            op.rect = rect;
            op.text = std::move(value);
            op.color = color;
            op.fontSize = 9.5f;
            op.lineHeight = lineHeight;
            op.maxLines = 1;
            op.overflow = TextOverflow::Clip;
            return op;
        }

        Rect outset(Rect rect, float amount) noexcept {
            return {rect.x - amount, rect.y - amount, rect.width + amount * 2, rect.height + amount * 2};
        }

        Rect unite(Rect a, Rect b) noexcept {
            if (a.width <= 0 || a.height <= 0) return b;
            if (b.width <= 0 || b.height <= 0) return a;
            const auto left = std::min(a.x, b.x), top = std::min(a.y, b.y);
            const auto right = std::max(a.x + a.width, b.x + b.width), bottom = std::max(a.y + a.height, b.y + b.height);
            return {left, top, right - left, bottom - top};
        }

        std::uint32_t withAlpha(std::uint32_t rgb, double alpha) noexcept {
            const auto value = static_cast<std::uint32_t>(std::clamp(alpha, 0.0, 1.0) * 255.0 + 0.5);
            return (value << 24) | (rgb & 0x00ffffffu);
        }

        std::uint32_t frameColor(const FrameRecord& record, double millis) noexcept {
            if (record.failed) return 0xffef4444u;
            if (millis <= budgetMillis * 0.5) return 0xff22c55eu;
            if (millis <= budgetMillis) return 0xfff59e0bu;
            return 0xffef4444u;
        }

        std::string format(const char* pattern, auto... values) {
            char buffer[128];
            std::snprintf(buffer, sizeof(buffer), pattern, values...);
            return buffer;
        }
    }

    std::vector<NodeOutline> collectNodeOutlines(const LayoutTree& tree, NodeId root) {
        std::vector<NodeOutline> outlines;
        if (!tree.contains(root)) return outlines;
        std::vector<NodeId> pending{root};
        while (!pending.empty()) {
            const auto id = pending.back();
            pending.pop_back();
            const auto& node = tree.node(id);
            // 以第一个修饰器为接收者：只计祖先变换，不计节点自身的变换
            const auto& elements = node.modifier.elements();
            const auto receiver = elements.empty() ? ModifierHandle{} : elements.front().handle;
            if (node.bounds.width > 0 && node.bounds.height > 0) outlines.push_back({id, nodeContentRectToRoot(tree, id, node.bounds, receiver)});
            for (auto child = node.children.rbegin(); child != node.children.rend(); ++child)
                if (tree.contains(*child)) pending.push_back(*child);
        }
        return outlines;
    }

    RepaintRegion DiagnosticsOverlay::update(const FrameTimeline& timeline, const PublishedFrame& frame, const LayoutTree& tree, NodeId root, double nowMillis) {
        RepaintDamage damage;
        const auto replace = [&](Part& part, Part next) {
            if (part.ops == next.ops) return;
            for (const auto& area : part.areas) damage.addRect(outset(area, 2));
            for (const auto& area : next.areas) damage.addRect(outset(area, 2));
            part = std::move(next);
        };
        if (!enabled_) {
            flashes_.clear();
            outlines_.clear();
            outlineRevision_ = 0;
            seenSequence_ = timeline.recorded();
            replace(flash_, {});
            replace(bounds_, {});
            replace(hit_, {});
            replace(panel_, {});
        } else {
            // 只把新记录的场景脏区加入闪烁；叠加层自身的重绘不进时间线
            if (layers_.dirtyFlash) {
                // 同一区域连续重绘只重新计时，不叠加，否则逐帧动画的半透明闪烁会叠成不透明
                const auto flash = [&](const Rect& rect) {
                    const auto existing = std::find_if(flashes_.begin(), flashes_.end(), [&](const Flash& item) { return item.rect == rect; });
                    if (existing != flashes_.end())
                        existing->started = nowMillis;
                    else
                        flashes_.push_back({rect, nowMillis});
                };
                for (auto index = timeline.size(); index > 0; --index) {
                    const auto& record = timeline.at(index - 1);
                    if (record.sequence <= seenSequence_) break;
                    if (record.repaint.full)
                        flash({0, 0, frame.content.viewport.width, frame.content.viewport.height});
                    else
                        for (const auto& rect : record.repaint.rects) flash(rect);
                }
                if (flashes_.size() > maxFlashes) flashes_.erase(flashes_.begin(), flashes_.end() - static_cast<std::ptrdiff_t>(maxFlashes));
            } else
                flashes_.clear();
            seenSequence_ = timeline.recorded();
            std::erase_if(flashes_, [&](const Flash& flash) { return nowMillis - flash.started >= flashMillis; });
            if (layers_.bounds || layers_.hit) {
                if (outlineRevision_ != frame.revision || outlines_.empty()) {
                    outlines_ = collectNodeOutlines(tree, root);
                    outlineRevision_ = frame.revision;
                }
            } else {
                outlines_.clear();
                outlineRevision_ = 0;
            }
            replace(flash_, buildFlashes(nowMillis));
            replace(bounds_, layers_.bounds ? buildBounds() : Part{});
            replace(hit_, layers_.hit ? buildHit(frame) : Part{});
            replace(panel_, layers_.frameTime || layers_.status ? buildPanel(timeline) : Part{});
        }
        ops_.clear();
        for (const auto* part : {&flash_, &bounds_, &hit_, &panel_}) ops_.insert(ops_.end(), part->ops.begin(), part->ops.end());
        return damage.finish(frame.content.viewport);
    }

    DiagnosticsOverlay::Part DiagnosticsOverlay::buildFlashes(double nowMillis) const {
        Part part;
        for (const auto& flash : flashes_) {
            const auto fade = 1.0 - std::clamp((nowMillis - flash.started) / flashMillis, 0.0, 1.0);
            part.ops.push_back(fill(flash.rect, withAlpha(0xff3b30u, 0.3 * fade)));
            part.ops.push_back(stroke(flash.rect, withAlpha(0xff3b30u, 0.8 * fade), 1));
            part.areas.push_back(flash.rect);
        }
        return part;
    }

    DiagnosticsOverlay::Part DiagnosticsOverlay::buildBounds() const {
        Part part;
        Rect area;
        for (const auto& outline : outlines_) {
            part.ops.push_back(stroke(outline.rect, 0x9938bdf8u, 1));
            area = unite(area, outline.rect);
        }
        if (!part.ops.empty()) part.areas.push_back(area);
        return part;
    }

    DiagnosticsOverlay::Part DiagnosticsOverlay::buildHit(const PublishedFrame& frame) const {
        Part part;
        if (!pointer_ || !frame.content.hitTest) return part;
        const auto hit = HitTester{}.hitTest(*frame.content.hitTest, *pointer_);
        if (!hit.hit) return part;
        const auto found = std::find_if(outlines_.begin(), outlines_.end(), [&](const NodeOutline& outline) { return outline.node == hit.node; });
        if (found == outlines_.end()) return part;
        part.ops.push_back(fill(found->rect, 0x3322c55eu));
        part.ops.push_back(stroke(found->rect, 0xff22c55eu, 2));
        part.areas.push_back(found->rect);
        return part;
    }

    DiagnosticsOverlay::Part DiagnosticsOverlay::buildPanel(const FrameTimeline& timeline) const {
        Part part;
        auto height = padding * 2;
        if (layers_.frameTime) height += graphHeight + 4 + lineHeight;
        if (layers_.status) height += lineHeight * 2;
        const Rect panel{panelX, panelY, panelWidth, height};
        part.ops.push_back(fill(panel, 0xd0111827u, 6));
        part.areas.push_back(panel);
        auto y = panel.y + padding;
        const auto* latest = timeline.latest();
        // 最新一帧的绘制耗时要到宿主重放后才补记，读数取上一帧
        const auto* painted = timeline.size() >= 2 ? &timeline.at(timeline.size() - 2) : nullptr;
        if (layers_.frameTime) {
            const Rect graph{panel.x + padding, y, panel.width - padding * 2, graphHeight};
            part.ops.push_back(fill(graph, 0x40ffffffu));
            const auto count = std::min(timeline.size(), graphFrames);
            const auto barWidth = graph.width / static_cast<float>(graphFrames);
            double worst = 0;
            for (std::size_t index = 0; index < count; ++index) {
                const auto& record = timeline.at(timeline.size() - count + index);
                // 最新一帧的绘制耗时随宿主重放增长，计入会让叠加层自身的重绘反复改变图表
                const auto millis = record.millis.total + (index + 1 == count ? 0.0 : record.millis.paint);
                worst = std::max(worst, millis);
                const auto barHeight = record.failed ? graph.height : static_cast<float>(std::min(1.0, millis / graphMillis)) * graph.height;
                const auto x = graph.x + graph.width - static_cast<float>(count - index) * barWidth;
                part.ops.push_back(fill({x, graph.y + graph.height - barHeight, std::max(1.0f, barWidth - 1), barHeight}, frameColor(record, millis)));
            }
            const auto budgetY = graph.y + graph.height - static_cast<float>(budgetMillis / graphMillis) * graph.height;
            part.ops.push_back(fill({graph.x, budgetY, graph.width, 1}, 0x80ffffffu));
            y += graphHeight + 4;
            const auto line = latest ? format("frame %.2f ms  paint %.2f ms  max %.1f", latest->millis.total, painted ? painted->millis.paint : 0.0, worst) : std::string("frame -");
            part.ops.push_back(text({panel.x + padding, y, panel.width - padding * 2, lineHeight}, line, 0xffe5e7ebu));
            y += lineHeight;
        }
        if (layers_.status) {
            std::string first = "rev -", second = "frag -";
            if (latest) {
                first = format("rev %llu  nodes %zu  draws %llu%s", static_cast<unsigned long long>(latest->revision), latest->nodes, static_cast<unsigned long long>(latest->drawRecords), latest->failed ? "  failed" : "");
                const auto dirty = latest->repaint.full ? std::string("full") : std::to_string(latest->repaint.rects.size());
                second = format("frag %llu/%llu  content %llu/%llu  dirty %s", static_cast<unsigned long long>(latest->fragmentsBuilt), static_cast<unsigned long long>(latest->fragmentsBuilt + latest->fragmentsReused), static_cast<unsigned long long>(latest->contentBuilds), static_cast<unsigned long long>(latest->contentBuilds + latest->contentReuses), dirty.c_str());
            }
            part.ops.push_back(text({panel.x + padding, y, panel.width - padding * 2, lineHeight}, first, 0xffcbd5e1u));
            y += lineHeight;
            part.ops.push_back(text({panel.x + padding, y, panel.width - padding * 2, lineHeight}, second, 0xffcbd5e1u));
        }
        return part;
    }
}
