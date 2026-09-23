#include <arrange/juce/LiveModuleClient.h>
#include <arrange/Log.h>

#if ARRANGE_JUCE_WITH_JUCE
namespace arrange::juce {
    namespace {
        quickjs::HotValue fromNetwork(const ::juce::var& value) {
            if (value.isBool()) return {static_cast<bool>(value)};
            if (value.isInt() || value.isInt64() || value.isDouble()) return {static_cast<double>(value)};
            if (value.isString()) return {value.toString().toStdString()};
            if (const auto* array = value.getArray()) {
                quickjs::HotValue::Array result;
                for (const auto& item : *array) result.push_back(fromNetwork(item));
                return {std::move(result)};
            }
            if (const auto* object = value.getDynamicObject()) {
                quickjs::HotValue::Object result;
                for (const auto& property : object->getProperties()) result.emplace(property.name.toString().toStdString(), fromNetwork(property.value));
                return {std::move(result)};
            }
            return {};
        }

        ::juce::var toNetwork(const quickjs::HotValue& input) {
            return std::visit(
                [](const auto& value) -> ::juce::var {
                    using T = std::decay_t<decltype(value)>;
                    if constexpr (std::is_same_v<T, std::monostate>)
                        return {};
                    else if constexpr (std::is_same_v<T, std::string>)
                        return ::juce::String(value);
                    else if constexpr (std::is_same_v<T, quickjs::HotValue::Array>) {
                        ::juce::Array<::juce::var> array;
                        for (const auto& item : value) array.add(toNetwork(item));
                        return array;
                    } else if constexpr (std::is_same_v<T, quickjs::HotValue::Object>) {
                        auto* object = new ::juce::DynamicObject();
                        for (const auto& [key, item] : value) object->setProperty(::juce::Identifier(key), toNetwork(item));
                        return object;
                    } else
                        return value;
                },
                input.value);
        }
    }  // namespace

    LiveModuleClient::LiveModuleClient() : ::juce::Thread("Arrange live modules") {}

    LiveModuleClient::~LiveModuleClient() {
        signalThreadShouldExit();
        std::shared_ptr<::juce::WebInputStream> request;
        {
            const std::lock_guard guard(mutex_);
            request = request_;
        }
        if (request) request->cancel();
        websocket_.stop();
        notify();
        stopThread(-1);
    }

    void LiveModuleClient::start(std::string url) {
        url_ = std::move(url);
        arrange::Log::i(TAG, "Live HMR 已连接", url_);
        startThread();
        // connected（包括断线重连）建立新快照，避免离线期间的编辑被遗漏
        websocket_.start(url_, [this](std::string message) { receive(std::move(message)); });
        requestReload();
    }

    void LiveModuleClient::requestReload() {
        {
            const std::lock_guard guard(mutex_);
            if (reloadPending_) return;
            reloadPending_ = true;
            quickjs::HotMessage message;
            message.type = "full-reload";
            requests_.push_back(std::move(message));
        }
        arrange::Log::i(TAG, "已请求 Live 模块快照");
        notify();
    }

    void LiveModuleClient::receive(std::string text) {
        const auto value = ::juce::JSON::parse(text);
        quickjs::HotMessage message;
        message.type = value["type"].toString().toStdString();
        if (message.type == "update" || message.type == "full-reload" || message.type == "prune") {
            arrange::Log::i(TAG, "已收到 Vite 更新事件", message.type);
        }
        if (message.type == "connected") {
            bool reload;
            {
                const std::lock_guard guard(mutex_);
                reload = std::exchange(connected_, true) || !hasSnapshot_;
            }
            if (reload) requestReload();
            return;
        }
        if (message.type == "error") {
            LiveModulePacket packet;
            packet.error = value["err"]["message"].toString().toStdString();
            const std::lock_guard guard(mutex_);
            packets_.push_back(std::move(packet));
            return;
        }
        if (message.type != "update" && message.type != "prune" && message.type != "full-reload" && message.type != "custom") return;
        if (const auto* updates = value["updates"].getArray())
            for (const auto& update : *updates) {
                if (update["type"].toString() != "js-update") continue;
                message.updates.push_back({"js-update", update["path"].toString().toStdString(), update["acceptedPath"].toString().toStdString(), static_cast<double>(update["timestamp"]), static_cast<bool>(update["explicitImportRequired"]), update["firstInvalidatedBy"].toString().toStdString()});
            }
        if (const auto* paths = value["paths"].getArray())
            for (const auto& path : *paths) message.paths.push_back(path.toString().toStdString());
        message.event = value["event"].toString().toStdString();
        message.data = fromNetwork(value["data"]);
        {
            const std::lock_guard guard(mutex_);
            requests_.push_back(std::move(message));
        }
        notify();
    }

    void LiveModuleClient::send(const quickjs::HotMessage& message) {
        if (message.event == "arrange:import") {
            arrange::Log::i(TAG, "已收到动态模块请求");
            {
                const std::lock_guard guard(mutex_);
                const auto* data = std::get_if<quickjs::HotValue::Object>(&message.data.value);
                if (!data || !data->contains("id") || !data->contains("url") || !std::holds_alternative<double>(data->at("id").value) || !std::holds_alternative<std::string>(data->at("url").value)) {
                    LiveModulePacket packet;
                    packet.error = "动态 ESM 请求必须提供数值 id 与字符串 url";
                    packets_.push_back(std::move(packet));
                    return;
                }
                auto request = message;
                request.type = "import";
                requests_.push_back(std::move(request));
            }
            notify();
            return;
        }
        websocket_.send(::juce::JSON::toString(toNetwork({quickjs::HotValue::Object{{"type", {message.type}}, {"event", {message.event}}, {"data", message.data}}}), true).toStdString());
    }

    std::vector<LiveModulePacket> LiveModuleClient::takePackets() {
        const std::lock_guard guard(mutex_);
        return std::exchange(packets_, {});
    }

    void LiveModuleClient::run() {
        while (!threadShouldExit()) {
            std::optional<quickjs::HotMessage> request;
            {
                const std::lock_guard guard(mutex_);
                if (!requests_.empty()) {
                    request = std::move(requests_.front());
                    requests_.pop_front();
                }
            }
            if (!request) {
                wait(100);
                continue;
            }
            auto packet = fetch(std::move(*request));
            if (packet.message.type == "import") {
                packet.message.type = "custom";
                packet.message.event = "arrange:import-ready";
                if (!packet.error.empty()) {
                    std::get<quickjs::HotValue::Object>(packet.message.data.value)["error"] = {std::exchange(packet.error, {})};
                    packet.unavailable = false;
                } else
                    arrange::Log::i(TAG, "已返回动态模块快照", packet.snapshot.modules.size(), "个模块");
            }
            const std::lock_guard guard(mutex_);
            if (packet.reload) {
                reloadPending_ = false;
                hasSnapshot_ = packet.error.empty();
            }
            packets_.push_back(std::move(packet));
        }
    }

    LiveModulePacket LiveModuleClient::fetch(quickjs::HotMessage message) {
        LiveModulePacket packet;
        packet.reload = message.type == "full-reload";
        packet.message = std::move(message);
        const bool dynamicImport = packet.message.type == "import";
        if (!packet.reload && packet.message.type != "update" && !dynamicImport) return packet;
        const auto endpoint = parseDevServerUrl(url_);
        std::string address = (endpoint.secure ? "https://" : "http://") + endpoint.host + ":" + std::to_string(endpoint.port) + "/@arrange/modules";
        const auto addRoot = [&](const std::string& path) {
            address += (address.find('?') == std::string::npos ? "?url=" : "&url=") + ::juce::URL::addEscapeChars(path, true).toStdString();
        };
        for (const auto& update : packet.message.updates) {
            const auto path = update.acceptedPath + (update.acceptedPath.find('?') == std::string::npos ? "?" : "&") + "t=" + std::to_string(static_cast<std::uint64_t>(update.timestamp)) + (update.explicitImportRequired ? "&import" : "");
            addRoot(path);
        }
        if (dynamicImport) addRoot(std::get<std::string>(std::get<quickjs::HotValue::Object>(packet.message.data.value).at("url").value));
        const auto url = ::juce::URL(address);
        auto stream = std::make_shared<::juce::WebInputStream>(url, false);
        stream->withConnectionTimeout(5000).withNumRedirectsToFollow(0);
        {
            const std::lock_guard guard(mutex_);
            if (threadShouldExit()) return packet;
            request_ = stream;
        }
        if (!stream->connect(nullptr)) {
            packet.unavailable = true;
            packet.error = "Live server 不可用：" + url.toString(true).toStdString();
            arrange::Log::e(TAG, "Live 快照请求失败", packet.error);
            return packet;
        }
        const auto status = stream->getStatusCode();
        const auto body = stream->readEntireStreamAsString();
        if (status != 200) {
            packet.error = "Live ESM 请求失败（HTTP " + std::to_string(status) + "）：" + body.toStdString();
            arrange::Log::e(TAG, "Live 快照响应异常", status, body.toStdString());
            return packet;
        }
        ::juce::var snapshot;
        const auto parsed = ::juce::JSON::parse(body, snapshot);
        const auto* modules = snapshot["modules"].getArray();
        if (parsed.failed() || !modules || !snapshot["entry"].isString()) {
            packet.error = "Live ESM 快照格式无效";
            return packet;
        }
        packet.snapshot.entry = snapshot["entry"].toString().toStdString();
        for (const auto& module : *modules) {
            if (!module["url"].isString() || !module["source"].isString()) {
                packet.error = "Live ESM 模块格式无效";
                break;
            }
            packet.snapshot.modules.push_back({module["url"].toString().toStdString(), module["source"].toString().toStdString(), ::juce::JSON::toString(module["map"]).toStdString()});
        }
        if (!packet.error.empty()) arrange::Log::e(TAG, "Live 模块快照解析失败", packet.error);
        else if (packet.reload) arrange::Log::i(TAG, "已收到 Live 模块快照", packet.snapshot.modules.size(), "个模块");
        return packet;
    }
}  // namespace arrange::juce
#endif
