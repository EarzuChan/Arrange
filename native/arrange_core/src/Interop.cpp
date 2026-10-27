#include <arrange/core/Interop.h>

namespace arrange::core {
    namespace {
        const InteropValue nullValue;
        const std::string emptyString;
        const InteropValue::Array emptyArray;
        const InteropValue::Object emptyObject;
    }

    InteropValue InteropValue::array(Array items) {
        InteropValue result;
        result.value_ = std::make_shared<const Array>(std::move(items));
        return result;
    }

    InteropValue InteropValue::object(Object fields) {
        InteropValue result;
        result.value_ = std::make_shared<const Object>(std::move(fields));
        return result;
    }

    bool InteropValue::asBool(bool fallback) const noexcept {
        const auto* value = std::get_if<bool>(&value_);
        return value ? *value : fallback;
    }

    double InteropValue::asNumber(double fallback) const noexcept {
        const auto* value = std::get_if<double>(&value_);
        return value ? *value : fallback;
    }

    const std::string& InteropValue::asString() const noexcept {
        const auto* value = std::get_if<std::string>(&value_);
        return value ? *value : emptyString;
    }

    const InteropValue::Array& InteropValue::asArray() const noexcept {
        const auto* value = std::get_if<std::shared_ptr<const Array>>(&value_);
        return value && *value ? **value : emptyArray;
    }

    const InteropValue::Object& InteropValue::asObject() const noexcept {
        const auto* value = std::get_if<std::shared_ptr<const Object>>(&value_);
        return value && *value ? **value : emptyObject;
    }

    std::size_t InteropValue::size() const noexcept {
        if (isArray()) return asArray().size();
        if (isObject()) return asObject().size();
        return 0;
    }

    const InteropValue& InteropValue::operator[](std::size_t index) const noexcept {
        const auto& items = asArray();
        return index < items.size() ? items[index] : nullValue;
    }

    const InteropValue& InteropValue::operator[](std::string_view key) const noexcept {
        for (const auto& [name, value] : asObject())
            if (name == key) return value;
        return nullValue;
    }

    bool InteropValue::operator==(const InteropValue& other) const noexcept {
        if (value_.index() != other.value_.index()) return false;
        if (isArray()) return asArray() == other.asArray();
        if (isObject()) return asObject() == other.asObject();
        return value_ == other.value_;
    }

    InteropReply::InteropReply(Deliver deliver) : state_(std::make_shared<State>(State{std::move(deliver), false})) {}

    void InteropReply::resolve(InteropValue value) const {
        settle({true, std::move(value), {}});
    }

    void InteropReply::reject(std::string error) const {
        settle({false, {}, std::move(error)});
    }

    bool InteropReply::pending() const noexcept {
        return state_ && !state_->settled;
    }

    void InteropReply::settle(InteropOutcome outcome) const {
        if (!state_ || state_->settled) return;
        state_->settled = true;
        auto deliver = std::move(state_->deliver);
        state_->deliver = nullptr;
        if (deliver) deliver(std::move(outcome));
    }
}
