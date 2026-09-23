#include <arrange/juce/DevServerClient.h>

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <cstring>
#include <random>
#include <sstream>
#include <thread>
#include <vector>

namespace arrange {
    namespace {
        std::string trimCopy(std::string_view value) {
            while (!value.empty() && (value.front() == ' ' || value.front() == '\t' || value.front() == '\r' || value.front() == '\n')) value.remove_prefix(1);
            while (!value.empty() && (value.back() == ' ' || value.back() == '\t' || value.back() == '\r' || value.back() == '\n')) value.remove_suffix(1);
            return std::string(value);
        }

#if ARRANGE_JUCE_WITH_JUCE
        std::string base64Encode(const std::vector<std::uint8_t>& bytes) {
            static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            std::string result;
            result.reserve(((bytes.size() + 2) / 3) * 4);
            for (std::size_t i = 0; i < bytes.size(); i += 3) {
                const auto a = bytes[i];
                const auto b = i + 1 < bytes.size() ? bytes[i + 1] : 0;
                const auto c = i + 2 < bytes.size() ? bytes[i + 2] : 0;
                const auto triple = (static_cast<unsigned>(a) << 16u) | (static_cast<unsigned>(b) << 8u) | static_cast<unsigned>(c);
                result.push_back(alphabet[(triple >> 18u) & 0x3fu]);
                result.push_back(alphabet[(triple >> 12u) & 0x3fu]);
                result.push_back(i + 1 < bytes.size() ? alphabet[(triple >> 6u) & 0x3fu] : '=');
                result.push_back(i + 2 < bytes.size() ? alphabet[triple & 0x3fu] : '=');
            }
            return result;
        }

        std::string websocketKey() {
            std::vector<std::uint8_t> bytes(16);
            std::random_device random;
            for (auto& byte : bytes) byte = static_cast<std::uint8_t>(random());
            return base64Encode(bytes);
        }

        bool writeAll(::juce::StreamingSocket& socket, const void* data, int size) {
            const auto* cursor = static_cast<const char*>(data);
            int remaining = size;
            while (remaining > 0) {
                const auto written = socket.write(cursor, remaining);
                if (written <= 0) return false;
                cursor += written;
                remaining -= written;
            }
            return true;
        }

        bool readExact(::juce::StreamingSocket& socket, void* data, int size, ::juce::Thread& thread) {
            auto* cursor = static_cast<char*>(data);
            int remaining = size;
            while (remaining > 0 && !thread.threadShouldExit()) {
                const auto ready = socket.waitUntilReady(true, 250);
                if (ready < 0) return false;
                if (ready == 0) continue;
                const auto count = socket.read(cursor, remaining, false);
                if (count <= 0) return false;
                cursor += count;
                remaining -= count;
            }
            return remaining == 0;
        }

        bool sendClientFrame(::juce::StreamingSocket& socket, std::uint8_t opcode, std::string_view payload) {
            std::vector<std::uint8_t> frame;
            frame.push_back(static_cast<std::uint8_t>(0x80u | opcode));
            const auto length = payload.size();
            if (length <= 125) {
                frame.push_back(static_cast<std::uint8_t>(0x80u | length));
            } else if (length <= 0xffffu) {
                frame.push_back(0x80u | 126u);
                frame.push_back(static_cast<std::uint8_t>((length >> 8u) & 0xffu));
                frame.push_back(static_cast<std::uint8_t>(length & 0xffu));
            } else {
                if (length > 1024u * 1024u) return false;
                frame.push_back(0x80u | 127u);
                for (int shift = 56; shift >= 0; shift -= 8) frame.push_back(static_cast<std::uint8_t>((static_cast<std::uint64_t>(length) >> shift) & 0xffu));
            }
            std::random_device random;
            std::uint8_t mask[4];
            for (auto& byte : mask) byte = static_cast<std::uint8_t>(random());
            frame.insert(frame.end(), std::begin(mask), std::end(mask));
            for (std::size_t i = 0; i < payload.size(); ++i) frame.push_back(static_cast<std::uint8_t>(payload[i]) ^ mask[i % 4u]);
            return writeAll(socket, frame.data(), static_cast<int>(frame.size()));
        }
#endif
    }  // namespace

    DevServerEndpoint parseDevServerUrl(std::string_view url) {
        DevServerEndpoint endpoint;
        auto input = trimCopy(url);
        if (input.empty()) {
            endpoint.error = "Arrange dev server URL is empty.";
            return endpoint;
        }

        const auto schemeSep = input.find("://");
        if (schemeSep == std::string::npos) {
            endpoint.error = "Arrange dev server URL must include http://, https://, ws:// or wss://.";
            return endpoint;
        }

        endpoint.protocol = input.substr(0, schemeSep);
        endpoint.secure = endpoint.protocol == "https" || endpoint.protocol == "wss";
        if (endpoint.protocol != "http" && endpoint.protocol != "https" && endpoint.protocol != "ws" && endpoint.protocol != "wss") {
            endpoint.error = "Arrange dev server URL has unsupported protocol: " + endpoint.protocol;
            return endpoint;
        }

        auto rest = input.substr(schemeSep + 3);
        const auto slash = rest.find('/');
        const auto hostPort = slash == std::string::npos ? rest : rest.substr(0, slash);
        endpoint.basePath = slash == std::string::npos ? "/" : rest.substr(slash);
        if (endpoint.basePath.empty()) endpoint.basePath = "/";
        if (endpoint.basePath.front() != '/') endpoint.basePath.insert(endpoint.basePath.begin(), '/');
        endpoint.websocketPath = endpoint.basePath;
        const auto query = endpoint.websocketPath.find('?');
        if (query != std::string::npos) endpoint.websocketPath.resize(query);
        if (endpoint.websocketPath.empty()) endpoint.websocketPath = "/";

        const auto colon = hostPort.rfind(':');
        if (colon == std::string::npos) {
            endpoint.host = hostPort;
            endpoint.port = endpoint.secure ? 443 : 80;
        } else {
            endpoint.host = hostPort.substr(0, colon);
            const auto portText = std::string_view(hostPort).substr(colon + 1);
            auto parsed = 0;
            const auto [ptr, ec] = std::from_chars(portText.data(), portText.data() + portText.size(), parsed);
            if (ec != std::errc{} || ptr != portText.data() + portText.size() || parsed <= 0 || parsed > 65535) {
                endpoint.error = "Arrange dev server URL has invalid port: " + std::string(portText);
                return endpoint;
            }
            endpoint.port = parsed;
        }

        if (endpoint.host.empty()) {
            endpoint.error = "Arrange dev server URL host is empty.";
            return endpoint;
        }

        endpoint.ok = true;
        return endpoint;
    }

#if ARRANGE_JUCE_WITH_JUCE

    DevServerClient::DevServerClient() : ::juce::Thread("Arrange DevServerClient") {}

    DevServerClient::~DevServerClient() {
        stop();
    }

    void DevServerClient::stop() {
        running_ = false;
        signalThreadShouldExit();
        std::shared_ptr<::juce::StreamingSocket> socket;
        {
            const ::juce::ScopedLock guard(lock_);
            socket = socket_;
        }
        if (socket) socket->close();
        stopThread(-1);
        const ::juce::ScopedLock guard(lock_);
        socket_.reset();
        outgoing_.clear();
        messageCallback_ = {};
    }

    void DevServerClient::start(std::string devServerUrl, std::function<void(std::string)> callback) {
        stop();
        {
            const ::juce::ScopedLock guard(lock_);
            devServerUrl_ = std::move(devServerUrl);
            messageCallback_ = std::move(callback);
            lastError_.clear();
        }
        running_ = true;
        startThread();
    }

    void DevServerClient::send(std::string message) {
        const ::juce::ScopedLock guard(lock_);
        outgoing_.push_back(std::move(message));
    }

    std::string DevServerClient::lastError() const {
        const ::juce::ScopedLock guard(lock_);
        return lastError_;
    }

    void DevServerClient::run() {
        while (!threadShouldExit()) {
            std::string url;
            {
                const ::juce::ScopedLock guard(lock_);
                url = devServerUrl_;
            }

            const auto endpoint = parseDevServerUrl(url);
            if (!endpoint.ok) {
                const ::juce::ScopedLock guard(lock_);
                lastError_ = endpoint.error;
                break;
            }

            if (!connectAndPump(endpoint)) {
                if (threadShouldExit()) break;
                for (int i = 0; i < 10 && !threadShouldExit(); ++i) wait(100);
            }
        }
        running_ = false;
    }

    bool DevServerClient::connectAndPump(const DevServerEndpoint& endpoint) {
        if (endpoint.secure) {
            const ::juce::ScopedLock guard(lock_);
            lastError_ = "Arrange live WebSocket 目前支持本地 http/ws 地址";
            return false;
        }

        {
            const ::juce::ScopedLock guard(lock_);
            if (threadShouldExit()) return false;
            socket_ = std::make_shared<::juce::StreamingSocket>();
        }
        if (!socket_->connect(endpoint.host, endpoint.port, 1500)) {
            const ::juce::ScopedLock guard(lock_);
            lastError_ = "Cannot connect Arrange dev server: " + endpoint.host + ":" + std::to_string(endpoint.port);
            return false;
        }

        const auto hostHeader = endpoint.host + ":" + std::to_string(endpoint.port);
        std::ostringstream request;
        request << "GET " << endpoint.websocketPath << " HTTP/1.1\r\n"
                << "Host: " << hostHeader << "\r\n"
                << "Upgrade: websocket\r\n"
                << "Connection: Upgrade\r\n"
                << "Sec-WebSocket-Key: " << websocketKey() << "\r\n"
                << "Sec-WebSocket-Version: 13\r\n"
                << "Sec-WebSocket-Protocol: vite-hmr\r\n"
                << "\r\n";
        const auto requestText = request.str();
        if (!writeAll(*socket_, requestText.data(), static_cast<int>(requestText.size()))) return false;

        std::string response;
        response.reserve(1024);
        while (!threadShouldExit() && response.find("\r\n\r\n") == std::string::npos) {
            const auto ready = socket_->waitUntilReady(true, 1500);
            if (ready <= 0) return false;
            // 不读过 HTTP header，避免把紧跟的 connected 帧丢掉
            char buffer[1];
            const auto count = socket_->read(buffer, static_cast<int>(sizeof(buffer)), false);
            if (count <= 0) return false;
            response.append(buffer, static_cast<std::size_t>(count));
            if (response.size() > 8192) return false;
        }

        if (response.find(" 101 ") == std::string::npos && response.find(" 101\r\n") == std::string::npos) {
            const ::juce::ScopedLock guard(lock_);
            lastError_ = "Arrange dev server refused WebSocket upgrade.";
            return false;
        }

        {
            const ::juce::ScopedLock guard(lock_);
            lastError_.clear();
        }

        std::string fragments;
        bool fragmented = false;
        while (!threadShouldExit()) {
            std::deque<std::string> outgoing;
            {
                const ::juce::ScopedLock guard(lock_);
                outgoing.swap(outgoing_);
            }
            for (const auto& message : outgoing)
                if (!sendClientFrame(*socket_, 0x1u, message)) return false;
            const auto ready = socket_->waitUntilReady(true, 50);
            if (ready < 0) return false;
            if (!ready) continue;
            std::uint8_t header[2] = {};
            if (!readExact(*socket_, header, 2, *this)) return false;
            const auto opcode = static_cast<std::uint8_t>(header[0] & 0x0fu);
            auto length = static_cast<std::uint64_t>(header[1] & 0x7fu);
            if (length == 126) {
                std::uint8_t ext[2] = {};
                if (!readExact(*socket_, ext, 2, *this)) return false;
                length = (static_cast<std::uint64_t>(ext[0]) << 8u) | ext[1];
            } else if (length == 127) {
                std::uint8_t ext[8] = {};
                if (!readExact(*socket_, ext, 8, *this)) return false;
                length = 0;
                for (auto byte : ext) length = (length << 8u) | byte;
            }

            if ((header[1] & 0x80u) != 0 || (header[0] & 0x70u) != 0) return false;

            if (length > 1024u * 1024u) return false;
            std::string payload(static_cast<std::size_t>(length), '\0');
            if (length > 0 && !readExact(*socket_, payload.data(), static_cast<int>(payload.size()), *this)) return false;

            if (opcode == 0x8u) return false;
            if (opcode == 0x9u) {
                if (length > 125 || (header[0] & 0x80u) == 0) return false;
                (void)sendClientFrame(*socket_, 0xau, payload);
                continue;
            }
            if (opcode == 0xau) continue;
            if (opcode != 0x1u && opcode != 0x0u) return false;
            if (opcode == 0x0u && !fragmented || opcode == 0x1u && fragmented) return false;
            if (opcode == 0x0u || (header[0] & 0x80u) == 0) {
                fragments += payload;
                if (fragments.size() > 1024u * 1024u) return false;
                fragmented = (header[0] & 0x80u) == 0;
                if (fragmented) continue;
                payload = std::exchange(fragments, {});
            }

            std::function<void(std::string)> messageCallback;
            {
                const ::juce::ScopedLock guard(lock_);
                messageCallback = messageCallback_;
            }
            if (messageCallback) messageCallback(payload);
        }
        return true;
    }

#endif
}  // namespace arrange
