#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace arrange::core {
    // 跨界值：null、布尔、数字、字符串、数组与有序字符串键对象，在 QuickJS 边界直接构造为 JSValue
    class InteropValue {
       public:
        using Array = std::vector<InteropValue>;
        using Object = std::vector<std::pair<std::string, InteropValue>>;

        InteropValue() = default;

        InteropValue(std::nullptr_t) {}

        InteropValue(bool value) : value_(value) {}

        InteropValue(int value) : value_(static_cast<double>(value)) {}

        InteropValue(double value) : value_(value) {}

        InteropValue(float value) : value_(static_cast<double>(value)) {}

        InteropValue(const char* value) : value_(std::string(value)) {}

        InteropValue(std::string value) : value_(std::move(value)) {}

        InteropValue(std::string_view value) : value_(std::string(value)) {}

        static InteropValue array(Array items);
        static InteropValue object(Object fields);

        [[nodiscard]] bool isNull() const noexcept {
            return std::holds_alternative<std::monostate>(value_);
        }

        [[nodiscard]] bool isBool() const noexcept {
            return std::holds_alternative<bool>(value_);
        }

        [[nodiscard]] bool isNumber() const noexcept {
            return std::holds_alternative<double>(value_);
        }

        [[nodiscard]] bool isString() const noexcept {
            return std::holds_alternative<std::string>(value_);
        }

        [[nodiscard]] bool isArray() const noexcept {
            return std::holds_alternative<std::shared_ptr<const Array>>(value_);
        }

        [[nodiscard]] bool isObject() const noexcept {
            return std::holds_alternative<std::shared_ptr<const Object>>(value_);
        }

        // 类型不符时返回给定的回退值，取用方不必先判型
        [[nodiscard]] bool asBool(bool fallback = false) const noexcept;
        [[nodiscard]] double asNumber(double fallback = 0.0) const noexcept;
        [[nodiscard]] const std::string& asString() const noexcept;
        [[nodiscard]] const Array& asArray() const noexcept;
        [[nodiscard]] const Object& asObject() const noexcept;

        [[nodiscard]] std::size_t size() const noexcept;
        [[nodiscard]] const InteropValue& operator[](std::size_t index) const noexcept;
        [[nodiscard]] const InteropValue& operator[](std::string_view key) const noexcept;
        [[nodiscard]] bool operator==(const InteropValue& other) const noexcept;

       private:
        std::variant<std::monostate, bool, double, std::string, std::shared_ptr<const Array>, std::shared_ptr<const Object>> value_;
    };

    struct InteropParameter {
        std::string id;
        std::string name;
        std::string label;
        float defaultNormalized = 0.0f;
        // 0 表示连续参数
        int steps = 0;
        bool discrete = false;
        bool boolean = false;
        double minimum = 0.0;
        double maximum = 1.0;
    };

    struct InteropHostInfo {
        std::string name;
        std::string format = "unknown";
        // 0 表示尚未 prepare
        double sampleRate = 0.0;
        int blockSize = 0;

        [[nodiscard]] bool operator==(const InteropHostInfo&) const = default;
    };

    struct InteropTransport {
        bool playing = false;
        bool recording = false;
        bool looping = false;
        std::optional<double> bpm;
        std::optional<int> numerator;
        std::optional<int> denominator;
        std::optional<double> positionPpq;
        std::optional<double> positionSeconds;

        [[nodiscard]] bool operator==(const InteropTransport&) const = default;
    };

    struct InteropOutcome {
        bool ok = true;
        InteropValue value;
        std::string error;
    };

    // 异步调用的一次性回执；会话结束后的回执被丢弃
    class InteropReply {
       public:
        using Deliver = std::function<void(InteropOutcome)>;

        InteropReply() = default;
        explicit InteropReply(Deliver deliver);

        void resolve(InteropValue value = {}) const;
        void reject(std::string error) const;
        [[nodiscard]] bool pending() const noexcept;

       private:
        struct State {
            Deliver deliver;
            bool settled = false;
        };

        void settle(InteropOutcome outcome) const;
        std::shared_ptr<State> state_;
    };

    // 脚本会话面向宿主的接收端：宿主经它唤醒 UI owner、投递消息
    class InteropSessionSink {
       public:
        virtual ~InteropSessionSink() = default;
        virtual void wake() = 0;
        virtual void message(std::string name, InteropValue value) = 0;
    };

    // 脚本会话所面对的宿主抽象；除特别说明外均在 UI owner 线程调用
    class InteropHost {
       public:
        virtual ~InteropHost() = default;

        virtual void attach(InteropSessionSink& sink) = 0;
        virtual void detach(InteropSessionSink& sink) noexcept = 0;

        [[nodiscard]] virtual const std::vector<InteropParameter>& parameters() const = 0;
        [[nodiscard]] virtual float parameterValue(std::size_t index) const = 0;
        // 取走上次以来值有变化的参数下标
        virtual void takeParameterChanges(std::vector<std::size_t>& changed) = 0;
        [[nodiscard]] virtual double toPlain(std::size_t index, float normalized) const = 0;
        [[nodiscard]] virtual float toNormalized(std::size_t index, double plain) const = 0;
        [[nodiscard]] virtual std::string text(std::size_t index, float normalized) const = 0;
        [[nodiscard]] virtual std::optional<float> parse(std::size_t index, std::string_view text) const = 0;
        virtual void beginGesture(std::size_t index) = 0;
        virtual void setParameter(std::size_t index, float normalized) = 0;
        virtual void endGesture(std::size_t index) = 0;

        // 在当前指针位置弹出宿主为该参数提供的菜单；宿主不提供时返回 false
        virtual bool showParameterMenu(std::size_t) {
            return false;
        }

        [[nodiscard]] virtual InteropHostInfo hostInfo() const = 0;
        [[nodiscard]] virtual InteropTransport transport() const = 0;

        [[nodiscard]] virtual bool hasMeter(std::string_view name) const = 0;
        // 自上次取用以来的峰值，之后回落到最近电平
        [[nodiscard]] virtual float takeMeter(std::string_view name) = 0;
        [[nodiscard]] virtual std::optional<std::size_t> waveformCapacity(std::string_view name) const = 0;
        // 写入最近 out.size() 个样本，返回累计写入计数，用于判断是否有新数据
        virtual std::uint64_t readWaveform(std::string_view name, std::span<float> out) const = 0;
        [[nodiscard]] virtual std::optional<std::size_t> spectrumSize(std::string_view name) const = 0;
        // 有新发布时写入 out 并返回 true
        virtual bool readSpectrum(std::string_view name, std::span<float> out) = 0;

        // 调用不存在时以拒绝回执结束
        virtual void invoke(std::string_view name, const InteropValue& args, InteropReply reply) = 0;
    };
}
