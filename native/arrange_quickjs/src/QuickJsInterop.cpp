#include "QuickJsInterop.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iterator>

namespace arrange::quickjs {
    namespace {
        constexpr int maxValueDepth = 32;
        constexpr std::size_t maxSubscriptions = 1024;
        constexpr std::size_t maxStreamSize = 1u << 16;

        JSValue optionalNumber(JSContext* context, const std::optional<double>& value) {
            return value ? JS_NewFloat64(context, *value) : JS_NULL;
        }

        JSValue float32Array(JSContext* context, const std::vector<float>& data) {
            ScopedValue length(context, JS_NewInt64(context, static_cast<std::int64_t>(data.size())));
            JSValueConst args[]{length.get()};
            ScopedValue array(context, JS_NewTypedArray(context, 1, args, JS_TYPED_ARRAY_FLOAT32));
            if (JS_IsException(array.get())) return JS_EXCEPTION;
            std::size_t offset = 0, bytes = 0;
            ScopedValue buffer(context, JS_GetTypedArrayBuffer(context, array.get(), &offset, &bytes, nullptr));
            if (JS_IsException(buffer.get())) return JS_EXCEPTION;
            std::size_t size = 0;
            auto* target = JS_GetArrayBuffer(context, &size, buffer.get());
            if (!target || offset + bytes > size || bytes != data.size() * sizeof(float)) return JS_ThrowInternalError(context, "Float32Array 缓冲区不符");
            std::memcpy(target + offset, data.data(), bytes);
            return array.release();
        }

        bool readFinite(JSContext* context, JSValueConst value, double& out) {
            return JS_IsNumber(value) && JS_ToFloat64(context, &out, value) == 0 && std::isfinite(out);
        }
    }

    JSValue interopValueToJs(JSContext* context, const arrange::core::InteropValue& value) {
        if (value.isBool()) return JS_NewBool(context, value.asBool());
        if (value.isNumber()) return JS_NewFloat64(context, value.asNumber());
        if (value.isString()) return JS_NewStringLen(context, value.asString().data(), value.asString().size());
        if (value.isArray()) {
            ScopedValue array(context, JS_NewArray(context));
            std::uint32_t index = 0;
            for (const auto& item : value.asArray()) {
                const auto converted = interopValueToJs(context, item);
                if (JS_IsException(converted)) return JS_EXCEPTION;
                if (JS_SetPropertyUint32(context, array.get(), index++, converted) < 0) return JS_EXCEPTION;
            }
            return array.release();
        }
        if (value.isObject()) {
            ScopedValue object(context, JS_NewObject(context));
            for (const auto& [name, field] : value.asObject()) {
                const auto converted = interopValueToJs(context, field);
                if (JS_IsException(converted)) return JS_EXCEPTION;
                if (JS_SetPropertyStr(context, object.get(), name.c_str(), converted) < 0) return JS_EXCEPTION;
            }
            return object.release();
        }
        return JS_NULL;
    }

    std::optional<arrange::core::InteropValue> interopValueFromJs(JSContext* context, JSValueConst value, int depth) {
        if (depth > maxValueDepth) {
            JS_ThrowRangeError(context, "互操作值嵌套超过 %d 层", maxValueDepth);
            return std::nullopt;
        }
        if (JS_IsNull(value) || JS_IsUndefined(value)) return arrange::core::InteropValue{};
        if (JS_IsBool(value)) return arrange::core::InteropValue(static_cast<bool>(JS_ToBool(context, value)));
        if (JS_IsNumber(value)) {
            double number = 0;
            if (!readFinite(context, value, number)) {
                JS_ThrowTypeError(context, "互操作数字必须是有限数");
                return std::nullopt;
            }
            return arrange::core::InteropValue(number);
        }
        if (JS_IsString(value)) return arrange::core::InteropValue(QuickJsValueReader(context).toString(value));
        if (JS_IsArray(value)) {
            QuickJsValueReader reader(context);
            arrange::core::InteropValue::Array items;
            const auto length = reader.arrayLength(value);
            items.reserve(length);
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue item(context, JS_GetPropertyUint32(context, value, i));
                auto converted = interopValueFromJs(context, item.get(), depth + 1);
                if (!converted) return std::nullopt;
                items.push_back(std::move(*converted));
            }
            return arrange::core::InteropValue::array(std::move(items));
        }
        if (JS_IsObject(value) && !JS_IsFunction(context, value)) {
            JSPropertyEnum* names = nullptr;
            std::uint32_t count = 0;
            if (JS_GetOwnPropertyNames(context, &names, &count, value, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) return std::nullopt;
            arrange::core::InteropValue::Object fields;
            fields.reserve(count);
            bool ok = true;
            for (std::uint32_t i = 0; i < count && ok; ++i) {
                const char* key = JS_AtomToCString(context, names[i].atom);
                ScopedValue field(context, JS_GetProperty(context, value, names[i].atom));
                auto converted = key ? interopValueFromJs(context, field.get(), depth + 1) : std::nullopt;
                if (converted) fields.emplace_back(key, std::move(*converted));
                else ok = false;
                if (key) JS_FreeCString(context, key);
            }
            JS_FreePropertyEnum(context, names, count);
            if (!ok) return std::nullopt;
            return arrange::core::InteropValue::object(std::move(fields));
        }
        JS_ThrowTypeError(context, "互操作值只支持 null、布尔、数字、字符串、数组与普通对象");
        return std::nullopt;
    }

    QuickJsInterop::QuickJsInterop(JSContext* context, arrange::core::InteropHost& host, std::function<void()> wakeOwner) : context_(context), host_(&host), wakeOwner_(std::move(wakeOwner)) {
        replies_->wake = [this] { wake(); };
        deliveredHost_ = host_->hostInfo();
        host_->attach(*this);
    }

    QuickJsInterop::~QuickJsInterop() {
        close();
    }

    void QuickJsInterop::close() noexcept {
        if (host_) {
            // 宿主不应停留在编辑状态：会话结束时补齐未完成的 gesture
            for (const auto index : gestures_) host_->endGesture(index);
            gestures_.clear();
            host_->detach(*this);
            host_ = nullptr;
        }
        replies_->wake = nullptr;
        replies_->items.clear();
        replies_ = std::make_shared<Replies>();
        messages_.clear();
        subscriptions_.clear();
        streams_.clear();
        if (context_) JS_FreeValue(context_, driver_);
        driver_ = JS_UNDEFINED;
    }

    QuickJsInterop& QuickJsInterop::self(JSContext* context) {
        return *static_cast<QuickJsRuntimeContext*>(JS_GetContextOpaque(context))->interop;
    }

    void QuickJsInterop::install(JSValueConst native) {
        static const JSCFunctionListEntry functions[] = {
            JS_CFUNC_DEF("install", 1, jsInstall), JS_CFUNC_DEF("parameters", 0, jsParameters), JS_CFUNC_DEF("parameterValue", 1, jsParameterValue), JS_CFUNC_DEF("toPlain", 2, jsToPlain), JS_CFUNC_DEF("toNormalized", 2, jsToNormalized), JS_CFUNC_DEF("text", 2, jsText), JS_CFUNC_DEF("parse", 2, jsParse), JS_CFUNC_DEF("gesture", 2, jsGesture), JS_CFUNC_DEF("set", 3, jsSet), JS_CFUNC_DEF("host", 0, jsHost), JS_CFUNC_DEF("transport", 0, jsTransport), JS_CFUNC_DEF("subscribe", 3, jsSubscribe), JS_CFUNC_DEF("unsubscribe", 1, jsUnsubscribe), JS_CFUNC_DEF("invoke", 2, jsInvoke),
        };
        ScopedValue interop(context_, JS_NewObject(context_));
        JS_SetPropertyFunctionList(context_, interop.get(), functions, static_cast<int>(std::size(functions)));
        JS_SetPropertyStr(context_, native, "interop", interop.release());
    }

    void QuickJsInterop::setWakeOwner(std::function<void()> wake) {
        wakeOwner_ = std::move(wake);
        if (wakeRequested_ && wakeOwner_) wakeOwner_();
    }

    void QuickJsInterop::wake() {
        wakeRequested_ = true;
        if (wakeOwner_) wakeOwner_();
    }

    void QuickJsInterop::message(std::string name, arrange::core::InteropValue value) {
        if (!host_) return;
        messages_.emplace_back(std::move(name), std::move(value));
        wake();
    }

    bool QuickJsInterop::hasPending() const noexcept {
        return host_ && !JS_IsUndefined(driver_) && (wakeRequested_ || !messages_.empty() || !replies_->items.empty());
    }

    bool QuickJsInterop::wantsFrames() const {
        if (!host_ || JS_IsUndefined(driver_)) return false;
        for (const auto& [key, stream] : streams_) {
            if (stream.references == 0) continue;
            if (key.front() != 't') return true;
            const auto transport = host_->transport();
            if (transport.playing || deliveredTransport_.playing || !stream.delivered || !(transport == deliveredTransport_)) return true;
        }
        return false;
    }

    std::string QuickJsInterop::streamKey(StreamKind kind, const std::string& name) {
        constexpr const char* prefixes[]{"m:", "w:", "s:", "t:"};
        return prefixes[static_cast<int>(kind)] + name;
    }

    bool QuickJsInterop::call(const char* method, std::initializer_list<JSValueConst> args) {
        ScopedValue function(context_, JS_GetPropertyStr(context_, driver_, method));
        if (!JS_IsFunction(context_, function.get())) {
            JS_ThrowTypeError(context_, "互操作驱动缺少 %s", method);
            return false;
        }
        std::vector<JSValueConst> argv(args);
        ScopedValue result(context_, JS_Call(context_, function.get(), driver_, static_cast<int>(argv.size()), argv.data()));
        return !JS_IsException(result.get());
    }

    bool QuickJsInterop::pump(bool visualFrame) {
        if (!host_ || JS_IsUndefined(driver_)) return true;
        wakeRequested_ = false;

        changed_.clear();
        host_->takeParameterChanges(changed_);
        if (!changed_.empty()) {
            ScopedValue indices(context_, JS_NewArray(context_));
            ScopedValue values(context_, JS_NewArray(context_));
            for (std::uint32_t i = 0; i < changed_.size(); ++i) {
                JS_SetPropertyUint32(context_, indices.get(), i, JS_NewUint32(context_, static_cast<std::uint32_t>(changed_[i])));
                JS_SetPropertyUint32(context_, values.get(), i, JS_NewFloat64(context_, host_->parameterValue(changed_[i])));
            }
            if (!call("parameters", {indices.get(), values.get()})) return false;
        }

        const auto hostInfo = host_->hostInfo();
        if (!(hostInfo == deliveredHost_)) {
            deliveredHost_ = hostInfo;
            ScopedValue value(context_, hostInfoValue());
            if (!call("host", {value.get()})) return false;
        }

        // 回调可以增删订阅，先复制本轮要交付的流
        std::vector<std::pair<std::string, std::size_t>> streams;
        if (visualFrame)
            for (const auto& [key, stream] : streams_)
                if (stream.references > 0) streams.emplace_back(key, stream.size);
        for (const auto& [key, size] : streams) {
            const auto found = streams_.find(key);
            if (found == streams_.end()) continue;
            auto& stream = found->second;
            const auto name = key.substr(2);
            ScopedValue nameValue(context_, JS_NewStringLen(context_, name.data(), name.size()));
            if (key.front() == 't') {
                const auto transport = host_->transport();
                if (stream.delivered && transport == deliveredTransport_) continue;
                stream.delivered = true;
                deliveredTransport_ = transport;
                ScopedValue value(context_, transportValue(transport));
                if (!call("transport", {value.get()})) return false;
            } else if (key.front() == 'm') {
                const auto level = host_->takeMeter(name);
                if (stream.delivered && level == stream.meter) continue;
                stream.delivered = true;
                stream.meter = level;
                ScopedValue value(context_, JS_NewFloat64(context_, level));
                if (!call("meter", {nameValue.get(), value.get()})) return false;
            } else if (key.front() == 'w') {
                std::vector<float> samples(size);
                const auto count = host_->readWaveform(name, samples);
                if (stream.delivered && count == stream.waveformCount) continue;
                stream.delivered = true;
                stream.waveformCount = count;
                ScopedValue value(context_, float32Array(context_, samples));
                if (JS_IsException(value.get()) || !call("waveform", {nameValue.get(), value.get()})) return false;
            } else {
                std::vector<float> bins(size);
                if (!host_->readSpectrum(name, bins)) continue;
                ScopedValue value(context_, float32Array(context_, bins));
                if (JS_IsException(value.get()) || !call("spectrum", {nameValue.get(), value.get()})) return false;
            }
        }

        auto messages = std::move(messages_);
        messages_.clear();
        for (const auto& [name, payload] : messages) {
            ScopedValue nameValue(context_, JS_NewStringLen(context_, name.data(), name.size()));
            ScopedValue value(context_, interopValueToJs(context_, payload));
            if (JS_IsException(value.get()) || !call("message", {nameValue.get(), value.get()})) return false;
        }

        auto replies = std::move(replies_->items);
        replies_->items.clear();
        for (const auto& [id, outcome] : replies) {
            ScopedValue idValue(context_, JS_NewFloat64(context_, static_cast<double>(id)));
            ScopedValue value(context_, interopValueToJs(context_, outcome.value));
            ScopedValue error(context_, JS_NewStringLen(context_, outcome.error.data(), outcome.error.size()));
            if (JS_IsException(value.get()) || !call("reply", {idValue.get(), JS_NewBool(context_, outcome.ok), value.get(), error.get()})) return false;
        }
        return true;
    }

    JSValue QuickJsInterop::hostInfoValue() const {
        const auto info = host_->hostInfo();
        auto* context = context_;
        const auto object = JS_NewObject(context);
        JS_SetPropertyStr(context, object, "name", info.name.empty() ? JS_NULL : JS_NewStringLen(context, info.name.data(), info.name.size()));
        JS_SetPropertyStr(context, object, "format", JS_NewStringLen(context, info.format.data(), info.format.size()));
        JS_SetPropertyStr(context, object, "sampleRate", info.sampleRate > 0 ? JS_NewFloat64(context, info.sampleRate) : JS_NULL);
        JS_SetPropertyStr(context, object, "blockSize", info.blockSize > 0 ? JS_NewInt32(context, info.blockSize) : JS_NULL);
        return object;
    }

    JSValue QuickJsInterop::transportValue(const arrange::core::InteropTransport& transport) const {
        auto* context = context_;
        const auto object = JS_NewObject(context);
        JS_SetPropertyStr(context, object, "playing", JS_NewBool(context, transport.playing));
        JS_SetPropertyStr(context, object, "recording", JS_NewBool(context, transport.recording));
        JS_SetPropertyStr(context, object, "looping", JS_NewBool(context, transport.looping));
        JS_SetPropertyStr(context, object, "bpm", optionalNumber(context, transport.bpm));
        if (transport.numerator && transport.denominator) {
            const auto signature = JS_NewObject(context);
            JS_SetPropertyStr(context, signature, "numerator", JS_NewInt32(context, *transport.numerator));
            JS_SetPropertyStr(context, signature, "denominator", JS_NewInt32(context, *transport.denominator));
            JS_SetPropertyStr(context, object, "timeSignature", signature);
        } else
            JS_SetPropertyStr(context, object, "timeSignature", JS_NULL);
        JS_SetPropertyStr(context, object, "positionPpq", optionalNumber(context, transport.positionPpq));
        JS_SetPropertyStr(context, object, "positionSeconds", optionalNumber(context, transport.positionSeconds));
        return object;
    }

    bool QuickJsInterop::parameterIndex(JSValueConst value, std::size_t& index) const {
        double number = 0;
        if (!host_ || !readFinite(context_, value, number) || std::floor(number) != number || number < 0 || number >= static_cast<double>(host_->parameters().size())) {
            JS_ThrowRangeError(context_, "参数下标无效");
            return false;
        }
        index = static_cast<std::size_t>(number);
        return true;
    }

    JSValue QuickJsInterop::jsInstall(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        if (argc != 1 || !JS_IsObject(argv[0])) return JS_ThrowTypeError(context, "互操作驱动必须是对象");
        if (!JS_IsUndefined(bridge.driver_)) return JS_ThrowTypeError(context, "一个会话只能安装一个互操作驱动");
        bridge.driver_ = JS_DupValue(context, argv[0]);
        bridge.wake();
        return JS_UNDEFINED;
    }

    JSValue QuickJsInterop::jsParameters(JSContext* context, JSValueConst, int, JSValueConst*) {
        auto& bridge = self(context);
        if (!bridge.host_) return JS_ThrowInternalError(context, "互操作会话已结束");
        ScopedValue list(context, JS_NewArray(context));
        std::uint32_t index = 0;
        for (const auto& parameter : bridge.host_->parameters()) {
            const auto item = JS_NewObject(context);
            JS_SetPropertyStr(context, item, "index", JS_NewUint32(context, index));
            JS_SetPropertyStr(context, item, "id", JS_NewStringLen(context, parameter.id.data(), parameter.id.size()));
            JS_SetPropertyStr(context, item, "name", JS_NewStringLen(context, parameter.name.data(), parameter.name.size()));
            JS_SetPropertyStr(context, item, "label", JS_NewStringLen(context, parameter.label.data(), parameter.label.size()));
            JS_SetPropertyStr(context, item, "defaultNormalized", JS_NewFloat64(context, parameter.defaultNormalized));
            JS_SetPropertyStr(context, item, "steps", JS_NewInt32(context, parameter.steps));
            JS_SetPropertyStr(context, item, "discrete", JS_NewBool(context, parameter.discrete));
            JS_SetPropertyStr(context, item, "boolean", JS_NewBool(context, parameter.boolean));
            JS_SetPropertyStr(context, item, "minimum", JS_NewFloat64(context, parameter.minimum));
            JS_SetPropertyStr(context, item, "maximum", JS_NewFloat64(context, parameter.maximum));
            JS_SetPropertyStr(context, item, "value", JS_NewFloat64(context, bridge.host_->parameterValue(index)));
            JS_SetPropertyUint32(context, list.get(), index++, item);
        }
        return list.release();
    }

    JSValue QuickJsInterop::jsParameterValue(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        if (argc < 1 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        return JS_NewFloat64(context, bridge.host_->parameterValue(index));
    }

    JSValue QuickJsInterop::jsToPlain(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        double normalized = 0;
        if (argc < 2 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        if (!readFinite(context, argv[1], normalized)) return JS_ThrowTypeError(context, "标准化值必须是有限数");
        return JS_NewFloat64(context, bridge.host_->toPlain(index, static_cast<float>(std::clamp(normalized, 0.0, 1.0))));
    }

    JSValue QuickJsInterop::jsToNormalized(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        double plain = 0;
        if (argc < 2 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        if (!readFinite(context, argv[1], plain)) return JS_ThrowTypeError(context, "参数值必须是有限数");
        return JS_NewFloat64(context, std::clamp(bridge.host_->toNormalized(index, plain), 0.0f, 1.0f));
    }

    JSValue QuickJsInterop::jsText(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        double normalized = 0;
        if (argc < 2 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        if (!readFinite(context, argv[1], normalized)) return JS_ThrowTypeError(context, "标准化值必须是有限数");
        const auto text = bridge.host_->text(index, static_cast<float>(std::clamp(normalized, 0.0, 1.0)));
        return JS_NewStringLen(context, text.data(), text.size());
    }

    JSValue QuickJsInterop::jsParse(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        if (argc < 2 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        if (!JS_IsString(argv[1])) return JS_ThrowTypeError(context, "参数文本必须是字符串");
        const auto parsed = bridge.host_->parse(index, QuickJsValueReader(context).toString(argv[1]));
        return parsed ? JS_NewFloat64(context, std::clamp(*parsed, 0.0f, 1.0f)) : JS_NULL;
    }

    JSValue QuickJsInterop::jsGesture(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        if (argc < 2 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        const auto phase = JS_IsString(argv[1]) ? QuickJsValueReader(context).toString(argv[1]) : std::string();
        if (phase == "begin") {
            if (!bridge.gestures_.insert(index).second) return JS_ThrowTypeError(context, "参数 gesture 已经开始");
            bridge.host_->beginGesture(index);
        } else if (phase == "end") {
            if (bridge.gestures_.erase(index) == 0) return JS_ThrowTypeError(context, "参数 gesture 尚未开始");
            bridge.host_->endGesture(index);
        } else
            return JS_ThrowTypeError(context, "gesture 阶段必须是 begin 或 end");
        return JS_UNDEFINED;
    }

    JSValue QuickJsInterop::jsSet(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        std::size_t index = 0;
        double normalized = 0;
        if (argc < 3 || !bridge.parameterIndex(argv[0], index)) return JS_EXCEPTION;
        if (!readFinite(context, argv[1], normalized)) return JS_ThrowTypeError(context, "标准化值必须是有限数");
        const auto value = static_cast<float>(std::clamp(normalized, 0.0, 1.0));
        const auto complete = JS_ToBool(context, argv[2]);
        if (complete) {
            if (bridge.gestures_.contains(index)) return JS_ThrowTypeError(context, "参数 gesture 进行中，请用 gesture 写入");
            bridge.host_->beginGesture(index);
            bridge.host_->setParameter(index, value);
            bridge.host_->endGesture(index);
        } else {
            if (!bridge.gestures_.contains(index)) return JS_ThrowTypeError(context, "参数 gesture 尚未开始");
            bridge.host_->setParameter(index, value);
        }
        return JS_UNDEFINED;
    }

    JSValue QuickJsInterop::jsHost(JSContext* context, JSValueConst, int, JSValueConst*) {
        auto& bridge = self(context);
        if (!bridge.host_) return JS_ThrowInternalError(context, "互操作会话已结束");
        bridge.deliveredHost_ = bridge.host_->hostInfo();
        return bridge.hostInfoValue();
    }

    JSValue QuickJsInterop::jsTransport(JSContext* context, JSValueConst, int, JSValueConst*) {
        auto& bridge = self(context);
        if (!bridge.host_) return JS_ThrowInternalError(context, "互操作会话已结束");
        return bridge.transportValue(bridge.host_->transport());
    }

    JSValue QuickJsInterop::jsSubscribe(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        if (!bridge.host_) return JS_ThrowInternalError(context, "互操作会话已结束");
        if (argc < 2 || !JS_IsString(argv[0]) || !JS_IsString(argv[1])) return JS_ThrowTypeError(context, "订阅需要类别与名称");
        if (bridge.subscriptions_.size() >= maxSubscriptions) return JS_ThrowRangeError(context, "互操作订阅超过 %zu 项", maxSubscriptions);
        QuickJsValueReader reader(context);
        const auto kindName = reader.toString(argv[0]);
        Subscription subscription;
        subscription.name = reader.toString(argv[1]);
        if (kindName == "meter") {
            subscription.kind = StreamKind::Meter;
            if (!bridge.host_->hasMeter(subscription.name)) return JS_ThrowRangeError(context, "未登记的电平表：%s", subscription.name.c_str());
        } else if (kindName == "waveform") {
            subscription.kind = StreamKind::Waveform;
            const auto capacity = bridge.host_->waveformCapacity(subscription.name);
            if (!capacity) return JS_ThrowRangeError(context, "未登记的波形：%s", subscription.name.c_str());
            double size = 0;
            if (argc < 3 || !readFinite(context, argv[2], size) || std::floor(size) != size || size < 1 || size > static_cast<double>(*capacity)) return JS_ThrowRangeError(context, "波形长度须为 1 到 %zu 的整数", *capacity);
            subscription.size = static_cast<std::size_t>(size);
        } else if (kindName == "spectrum") {
            subscription.kind = StreamKind::Spectrum;
            const auto size = bridge.host_->spectrumSize(subscription.name);
            if (!size) return JS_ThrowRangeError(context, "未登记的频谱：%s", subscription.name.c_str());
            subscription.size = *size;
        } else if (kindName == "transport") {
            subscription.kind = StreamKind::Transport;
            subscription.name.clear();
        } else
            return JS_ThrowTypeError(context, "未知订阅类别：%s", kindName.c_str());
        if (subscription.size > maxStreamSize) return JS_ThrowRangeError(context, "观测数据长度超过 %zu", maxStreamSize);

        auto& stream = bridge.streams_[streamKey(subscription.kind, subscription.name)];
        ++stream.references;
        stream.size = std::max(stream.size, subscription.size);
        stream.delivered = false;
        const auto id = bridge.nextSubscription_++;
        bridge.subscriptions_.emplace(id, std::move(subscription));
        bridge.wake();
        return JS_NewFloat64(context, static_cast<double>(id));
    }

    JSValue QuickJsInterop::jsUnsubscribe(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        double id = 0;
        if (argc < 1 || !readFinite(context, argv[0], id)) return JS_ThrowTypeError(context, "订阅身份无效");
        const auto found = bridge.subscriptions_.find(static_cast<std::uint64_t>(id));
        if (found == bridge.subscriptions_.end()) return JS_UNDEFINED;
        const auto key = streamKey(found->second.kind, found->second.name);
        bridge.subscriptions_.erase(found);
        const auto stream = bridge.streams_.find(key);
        if (stream != bridge.streams_.end() && --stream->second.references == 0) bridge.streams_.erase(stream);
        return JS_UNDEFINED;
    }

    JSValue QuickJsInterop::jsInvoke(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        auto& bridge = self(context);
        if (!bridge.host_) return JS_ThrowInternalError(context, "互操作会话已结束");
        if (argc < 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(context, "调用需要名称");
        const auto args = interopValueFromJs(context, argc > 1 ? argv[1] : JS_UNDEFINED);
        if (!args) return JS_EXCEPTION;
        const auto id = bridge.nextCall_++;
        const auto replies = std::weak_ptr<Replies>(bridge.replies_);
        arrange::core::InteropReply reply([replies, id](arrange::core::InteropOutcome outcome) {
            const auto queue = replies.lock();
            if (!queue) return;
            queue->items.emplace_back(id, std::move(outcome));
            if (queue->wake) queue->wake();
        });
        try {
            bridge.host_->invoke(QuickJsValueReader(context).toString(argv[0]), *args, reply);
        } catch (const std::exception& error) {
            reply.reject(error.what());
        } catch (...) {
            reply.reject("原生调用抛出未知异常");
        }
        return JS_NewFloat64(context, static_cast<double>(id));
    }
}

#endif
