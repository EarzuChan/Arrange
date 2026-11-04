#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
#include <vector>

namespace arrange::core {
    // 原生 painter 参数：数值、颜色、布尔或数据源名
    enum class NativeParamKind : std::uint8_t { Number, Color, Boolean, Source };

    struct NativeParamSpec {
        std::string name;
        NativeParamKind kind = NativeParamKind::Number;
        bool operator==(const NativeParamSpec&) const = default;
    };

    using NativeParamValue = std::variant<double, std::uint32_t, bool, std::string>;

    // 解码后按参数表顺序排列的只读参数视图
    class NativePainterParams {
       public:
        NativePainterParams() = default;

        explicit NativePainterParams(std::vector<std::pair<std::string, NativeParamValue>> values) : values_(std::move(values)) {}

        [[nodiscard]] double number(std::string_view name, double fallback = 0.0) const {
            const auto* value = find(name);
            return value && std::holds_alternative<double>(*value) ? std::get<double>(*value) : fallback;
        }

        [[nodiscard]] std::uint32_t color(std::string_view name, std::uint32_t fallback = 0) const {
            const auto* value = find(name);
            return value && std::holds_alternative<std::uint32_t>(*value) ? std::get<std::uint32_t>(*value) : fallback;
        }

        [[nodiscard]] bool boolean(std::string_view name, bool fallback = false) const {
            const auto* value = find(name);
            return value && std::holds_alternative<bool>(*value) ? std::get<bool>(*value) : fallback;
        }

        [[nodiscard]] std::string_view source(std::string_view name) const {
            const auto* value = find(name);
            return value && std::holds_alternative<std::string>(*value) ? std::string_view(std::get<std::string>(*value)) : std::string_view();
        }

        [[nodiscard]] const std::vector<std::pair<std::string, NativeParamValue>>& values() const noexcept {
            return values_;
        }

        bool operator==(const NativePainterParams&) const = default;

       private:
        [[nodiscard]] const NativeParamValue* find(std::string_view name) const {
            for (const auto& [key, value] : values_)
                if (key == name) return &value;
            return nullptr;
        }

        std::vector<std::pair<std::string, NativeParamValue>> values_;
    };

    // 注册项：名称、参数表与后端实现；实现由渲染后端解释，core 不依赖 JUCE
    struct NativePainterEntry {
        std::string name;
        std::vector<NativeParamSpec> params;
        std::shared_ptr<const void> implementation;
    };

    // 进程内按名称注册的原生 painter。解码时按名称取当前注册项，热更新后自然重新绑定
    class NativePainterRegistry {
       public:
        static NativePainterRegistry& global() {
            static NativePainterRegistry registry;
            return registry;
        }

        // 同名重新注册替换旧项；已发布帧继续持有旧项直到被替换
        void add(NativePainterEntry entry) {
            auto shared = std::make_shared<const NativePainterEntry>(std::move(entry));
            std::scoped_lock lock(mutex_);
            entries_[shared->name] = std::move(shared);
        }

        void remove(const std::string& name) {
            std::scoped_lock lock(mutex_);
            entries_.erase(name);
        }

        [[nodiscard]] std::shared_ptr<const NativePainterEntry> find(const std::string& name) const {
            std::scoped_lock lock(mutex_);
            const auto found = entries_.find(name);
            return found == entries_.end() ? nullptr : found->second;
        }

       private:
        mutable std::mutex mutex_;
        std::unordered_map<std::string, std::shared_ptr<const NativePainterEntry>> entries_;
    };
}
