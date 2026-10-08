#include <arrange/juce/PainterResources.h>
#include <arrange/juce/AppResolver.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <atomic>
#include <chrono>
#include <fstream>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

using arrange::core::PainterLoader;
using arrange::core::PainterLoadResult;
using arrange::juce::PainterResourceLimits;
using namespace std::chrono_literals;

namespace {
    void check(bool condition, const std::string& message) {
        if (!condition) throw std::runtime_error(message);
    }

    ::juce::MemoryBlock png(::juce::Colour color) {
        ::juce::Image image(::juce::Image::ARGB, 3, 2, true);
        image.clear(image.getBounds(), color);
        ::juce::MemoryOutputStream stream;
        check(::juce::PNGImageFormat().writeImageToStream(image, stream), "PNG 测试资源编码失败");
        return stream.getMemoryBlock();
    }

    class HttpFixture {
       public:
        HttpFixture() : red_(png(::juce::Colours::red)), green_(png(::juce::Colours::green)) {
            check(listener_.createListener(0, "127.0.0.1"), "本机 HTTP 测试服务无法监听");
            origin = "http://127.0.0.1:" + std::to_string(listener_.getBoundPort());
            worker_ = std::jthread([this](std::stop_token stop) { serve(stop); });
        }

        ~HttpFixture() {
            worker_.request_stop();
            listener_.close();
            worker_.join();
        }

        std::string origin;

        std::vector<std::string> requests() {
            const std::lock_guard guard(mutex_);
            return requests_;
        }

       private:
        static void send(::juce::StreamingSocket& socket, const void* bytes, std::size_t size) {
            std::size_t offset = 0;
            while (offset < size) {
                const auto count = socket.write(static_cast<const char*>(bytes) + offset, static_cast<int>(size - offset));
                if (count <= 0) break;
                offset += static_cast<std::size_t>(count);
            }
        }

        static void send(::juce::StreamingSocket& socket, const std::string& text) {
            send(socket, text.data(), text.size());
        }

        void serve(std::stop_token stop) {
            while (!stop.stop_requested()) {
                if (listener_.waitUntilReady(true, 50) <= 0) continue;
                const std::unique_ptr<::juce::StreamingSocket> socket(listener_.waitForNextConnection());
                if (!socket) continue;
                std::string request;
                char byte;
                while (request.size() < 8192 && socket->waitUntilReady(true, 500) > 0 && socket->read(&byte, 1, false) == 1) {
                    request += byte;
                    if (request.ends_with("\r\n\r\n")) break;
                }
                const auto begin = request.find(' ');
                const auto end = request.find(' ', begin + 1);
                if (begin == std::string::npos || end == std::string::npos) continue;
                const auto path = request.substr(begin + 1, end - begin - 1);
                {
                    const std::lock_guard guard(mutex_);
                    requests_.push_back(path);
                }
                if (path == "/missing.png") {
                    send(*socket, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                if (path == "/redirect.png") {
                    send(*socket, "HTTP/1.1 302 Found\r\nLocation: http://example.com/image.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                if (path == "/large.png") {
                    send(*socket, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n");
                    send(*socket, std::string(1024, 'x'));
                    std::this_thread::sleep_for(100ms);
                    continue;
                }
                if (path == "/chunked.png") {
                    send(*socket, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
                    send(*socket, "800\r\n" + std::string(2048, 'x') + "\r\n0\r\n\r\n");
                    continue;
                }
                if (path == "/stall.png" || path == "/shutdown-stall.png") {
                    send(*socket, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 100\r\nConnection: close\r\n\r\n");
                    std::this_thread::sleep_for(path == "/stall.png" ? 350ms : 5500ms);
                    continue;
                }
                if (path.starts_with("/slow.")) std::this_thread::sleep_for(100ms);
                const bool svg = path.starts_with("/icon.svg") || path.starts_with("/slow.svg");
                const std::string svgText = "<svg xmlns='http://www.w3.org/2000/svg' width='13' height='7'><rect width='13' height='7' fill='red'/></svg>";
                const std::string broken = "broken image";
                const bool bad = path == "/broken.png";
                const bool html = path == "/html.png";
                const auto& bytes = path.ends_with("?t=2") ? green_ : red_;
                const auto* content = svg ? static_cast<const void*>(svgText.data()) : bad || html ? static_cast<const void*>(broken.data()) : bytes.getData();
                const auto size = svg ? svgText.size() : bad || html ? broken.size() : bytes.getSize();
                send(*socket, "HTTP/1.1 200 OK\r\nContent-Type: " + std::string(svg ? "image/svg+xml" : html ? "text/html" : "image/png") + "\r\nContent-Length: " + std::to_string(size) + "\r\nConnection: close\r\n\r\n");
                send(*socket, content, size);
            }
        }

        ::juce::MemoryBlock red_, green_;
        ::juce::StreamingSocket listener_;
        std::jthread worker_;
        std::mutex mutex_;
        std::vector<std::string> requests_;
    };

    HttpFixture& pendingExitServer() {
        // 测试服务晚于 JUCE GUI 关闭才回收，确保 worker 退出时 HTTP 仍在等待
        static HttpFixture server;
        return server;
    }

    PainterLoadResult load(const PainterLoader& loader, const std::string& path) {
        auto result = loader(path, {});
        check(result.wait_for(6s) == std::future_status::ready, "资源请求未在限时内结束：" + path);
        return result.get();
    }

    void expectFailure(const PainterLoader& loader, const std::string& path, const std::string& reason) {
        const auto result = load(loader, path);
        check(!result.content && result.error.find(reason) != std::string::npos, "资源失败诊断不完整：" + result.error);
    }

    void verifyLiveResources(bool failAfterRequests) {
        HttpFixture server;
        for (const PainterResourceLimits limits : {PainterResourceLimits{0, 100}, PainterResourceLimits{1024, 0}, PainterResourceLimits{1024, PainterResourceLimits::MaxTimeoutMs + 1}}) {
            bool rejected = false;
            try {
                (void)arrange::juce::livePainterLoader(server.origin, limits);
            } catch (const std::invalid_argument&) {
                rejected = true;
            }
            check(rejected, "资源预算或超时上限未拒绝非法设置");
        }
        const auto loader = arrange::juce::livePainterLoader(server.origin);
        for (const auto& path : {std::string("logo.png"), std::string("/logo.png"), server.origin + "/src/assets/logo.png?import&t=1", std::string("/src/assets/logo%252e.png"), std::string("/assets/space%20%E4%B8%AD.png")}) {
            const auto loaded = load(loader, path);
            check(loaded.content && loaded.content->intrinsicSize == arrange::core::Size{3, 2}, "Live PNG 未从当前 origin 解码：" + loaded.error);
        }
        const auto svg = load(loader, "/icon.svg");
        check(svg.content && svg.content->intrinsicSize == arrange::core::Size{13, 7}, "Live SVG 没有真实尺寸：" + svg.error);
        const auto before = load(loader, "/hot.png?t=1");
        const auto after = load(loader, "/hot.png?t=2");
        const auto oldContent = std::dynamic_pointer_cast<const arrange::juce::JucePainterContent>(before.content);
        const auto newContent = std::dynamic_pointer_cast<const arrange::juce::JucePainterContent>(after.content);
        check(oldContent && newContent && oldContent->image.getPixelAt(0, 0) != newContent->image.getPixelAt(0, 0), "资源时间戳未读取新内容，或改写了旧发布内容");
        for (const auto& path : {"../escape.png", "/a/%2e%2e/escape.png", "/a%2f..%2fescape.png", "file:///tmp/logo.png", "C:/logo.png", "C:\\logo.png", "//example.com/logo.png", "/%5c%5cexample.com/logo.png", "https://example.com/logo.png", "/bad%00.png"}) expectFailure(loader, path, "Live Painter");
        const auto requestCount = server.requests().size();
        expectFailure(loader, server.origin + ".example.com/logo.png", "跨 origin");
        check(server.requests().size() == requestCount, "越界资源执行了 HTTP 请求");
        expectFailure(loader, "/missing.png", "HTTP 404");
        expectFailure(loader, "/redirect.png", "HTTP 302");
        expectFailure(loader, "/broken.png", "无法解码");
        expectFailure(loader, "/html.png", "MIME 不支持");
        const auto bounded = arrange::juce::livePainterLoader(server.origin, {1024, 1000});
        expectFailure(bounded, "/large.png", "字节预算");
        expectFailure(bounded, "/chunked.png", "字节预算");
        const auto timed = arrange::juce::livePainterLoader(server.origin, {1024, 100});
        const auto started = std::chrono::steady_clock::now();
        expectFailure(timed, "/stall.png", "超时");
        check(std::chrono::steady_clock::now() - started < 1500ms, "阻塞响应读取没有遵守总时限");
        std::this_thread::sleep_for(350ms);

        arrange::quickjs::QuickJsScriptHost host;
        host.setPainterLoader(loader);
        for (const auto& path : {"/slow.png", "/slow.svg"}) {
            const auto retired = host.executeModule("live-painter-retire.js", "const n=globalThis.__ARRANGE_NATIVE__;n.createNode(1,'Root');const h=n.acquirePainter('" + std::string(path) + "',()=>{throw new Error('退休资源不得完成')});n.releasePainter(h)");
            check(retired.ok, retired.error);
            std::this_thread::sleep_for(200ms);
            check(host.semanticCheckpoint(16).ok && !host.hasPendingSemanticWork(), "真实 Live 请求退休后执行了旧回调");
            const auto pending = host.executeModule("live-painter-old.js", "const n=globalThis.__ARRANGE_NATIVE__;n.createNode(1,'Root');n.acquirePainter('" + std::string(path) + "',()=>{throw new Error('旧代际不得完成')})");
            check(pending.ok, pending.error);
            check(host.executeModule("live-painter-new.js", "globalThis.__ARRANGE_NATIVE__.createNode(1,'Root')").ok, "Live Painter 重载失败");
            std::this_thread::sleep_for(200ms);
            check(host.semanticCheckpoint(32).ok && !host.hasPendingSemanticWork(), "真实 Live 请求跨越了运行时代际");
        }
        if (failAfterRequests) throw std::runtime_error("有意触发 HTTP 与 SVG 请求后的失败退出回归");
        std::cout << "Live 当前 origin、URL 边界、PNG/SVG、HTTP 诊断、预算、超时和资源退休通过\n";
    }

    void verifyInlineAndPackageResources() {
        const auto bytes = png(::juce::Colours::red);
        const auto encoded = ::juce::Base64::toBase64(bytes.getData(), bytes.getSize()).toStdString();
        const auto pngUrl = "data:image/png;base64," + encoded;
        const std::string svgUrl = "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='13'%20height='7'%3e%3crect%20width='13'%20height='7'%20fill='%23ff0000'/%3e%3c/svg%3e";
        const auto directory = ::juce::File::getSpecialLocation(::juce::File::tempDirectory).getNonexistentChildFile("arrange-painter-test", "", false);
        check(directory.createDirectory().wasOk(), "资源包测试目录创建失败");
        const auto cleanup = ::juce::ScopeGuard([&] { directory.deleteRecursively(); });
        check(directory.getChildFile("logo.png").replaceWithData(bytes.getData(), bytes.getSize()), "资源包测试 PNG 写入失败");
        for (const auto* name : {"logo 中文.png", "logo%2e.png", "logo%20.png"}) check(directory.getChildFile(::juce::String::fromUTF8(name)).replaceWithData(bytes.getData(), bytes.getSize()), "资源包特殊文件名写入失败");
        const auto package = arrange::juce::packagePainterLoader(directory.getFullPathName().toStdString());
        for (const auto& loader : {package, arrange::juce::livePainterLoader("http://127.0.0.1:1")}) {
            const auto bitmap = load(loader, pngUrl);
            const auto svg = load(loader, svgUrl);
            check(bitmap.content && bitmap.content->intrinsicSize == arrange::core::Size{3, 2}, "内联 PNG 解码失败：" + bitmap.error);
            check(svg.content && svg.content->intrinsicSize == arrange::core::Size{13, 7}, "内联 SVG 解码失败：" + svg.error);
            expectFailure(loader, "data:text/html,hello", "只支持");
            expectFailure(loader, "data:image/png;base64,!", "base64");
            expectFailure(loader, "data:image/svg+xml,%ZZ", "百分号");
            expectFailure(loader, "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%3e%3cimage%20xlink:href='file:///tmp/secret.png'/%3e%3c/svg%3e", "外部资源");
            expectFailure(loader, "data:image/svg+xml,%3c!DOCTYPE%20svg%20SYSTEM%20'file:///tmp/secret'%3e%3csvg/%3e", "DTD");
        }
        expectFailure(arrange::juce::livePainterLoader("http://127.0.0.1:1", {16, 1000}), pngUrl, "字节预算");
        for (const auto& path : {"logo.png", "/logo.png", "/logo.png?cache=1#fragment", "logo 中文.png", "/logo%20%E4%B8%AD%E6%96%87.png", "logo%2e.png", "/logo%252e.png", "logo%20.png", "/logo%2520.png"}) check(load(package, path).content != nullptr, "Dist 包根路径未加载");
        for (const auto& path : {"../logo.png", "/../logo.png", "/%2e%2e/logo.png", "/%2f%2fserver/logo.png", "/C%3a/logo.png", "/bad%00.png", "/bad%ZZ.png", "C:/logo.png", "C:\\logo.png", "//server/logo.png", "\\\\server\\logo.png", "http://127.0.0.1/logo.png", "file:///tmp/logo.png"}) check(!arrange::resolvePackageResource(directory.getFullPathName().toStdString(), path).ok, "Dist 接受了文件路径或包外资源");
#if !defined(_WIN32)
        check(directory.getChildFile("question?.png").replaceWithData(bytes.getData(), bytes.getSize()), "问号文件名写入失败");
        check(load(package, "question?.png").content && load(package, "/question%3F.png?cache=1").content, "URL query 与文件名中的问号混淆");
#endif
        std::cout << "内联资源、Dist 包根语义和文件边界通过\n";
    }
}

class PainterTestApplication final : public ::juce::JUCEApplication {
   public:
    const ::juce::String getApplicationName() override {
        return ::juce::String::fromUTF8("Arrange Painter 资源回归");
    }

    const ::juce::String getApplicationVersion() override {
        return "1";
    }

    void initialise(const ::juce::String& arguments) override {
        const bool exitDuringSvg = arguments.contains("--exit-pending-svg");
        const bool exitDuringHttp = arguments.contains("--exit-pending-http");
        tests_ = std::thread([this, failAfterRequests = arguments.contains("--fail-after-http"), exitDuringSvg, exitDuringHttp] {
            int result = 0;
            try {
                if (exitDuringSvg || exitDuringHttp) {
                    auto& server = pendingExitServer();
                    const auto loader = arrange::juce::livePainterLoader(server.origin);
                    auto request = loader(exitDuringHttp ? "/shutdown-stall.png" : "/slow.svg", {});
                    const auto limit = std::chrono::steady_clock::now() + 1s;
                    while (server.requests().empty() && std::chrono::steady_clock::now() < limit) std::this_thread::sleep_for(2ms);
                    check(!server.requests().empty(), "退出回归未开始真实 HTTP 请求");
                    throw std::runtime_error(exitDuringHttp ? "有意在 HTTP 请求尚未完成时退出" : "有意在 SVG 请求尚未完成时退出");
                } else {
                    verifyLiveResources(failAfterRequests);
                    verifyInlineAndPackageResources();
                }
            } catch (const std::exception& error) {
                std::cerr << error.what() << '\n';
                result = 1;
            }
            ::juce::MessageManager::callAsync([this, result] {
                setApplicationReturnValue(result);
                quit();
            });
        });
    }

    void shutdown() override {
        if (tests_.joinable()) tests_.join();
    }

   private:
    std::thread tests_;
};

int main(int argc, char** argv) {
    ::juce::JUCEApplicationBase::createInstance = []() -> ::juce::JUCEApplicationBase* {
        return new PainterTestApplication();
    };
    std::vector<const char*> arguments(argv, argv + argc);
    return ::juce::JUCEApplicationBase::main(argc, arguments.data());
}
