#include <arrange/juce/LiveModuleClient.h>
#include <arrange/quickjs/QuickJsScriptHost.h>
#include <chrono>
#include <iostream>
#include <thread>

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    arrange::juce::LiveModuleClient client;
    client.start(argv[1]);
    std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(90);
    while (std::chrono::steady_clock::now() < deadline) {
        for (auto& packet : client.takePackets()) {
            if (!packet.error.empty()) {
                std::cout << "ERROR " << packet.error << std::endl;
                continue;
            }
            if (packet.reload) {
                host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
                const auto result = host->executeLiveModules(packet.snapshot);
                if (!result.ok) {
                    std::cerr << result.error << std::endl;
                    return 1;
                }
                std::cout << "LOAD" << std::endl;
            } else if (host) {
                const auto result = host->applyHotUpdate(packet.snapshot, packet.message);
                if (!result.ok) {
                    std::cerr << result.error << std::endl;
                    return 1;
                }
            }
        }
        if (host) {
            for (const auto& message : host->takeHotMessages()) {
                if (message.event == "test:probe") {
                    const auto& data = std::get<arrange::quickjs::HotValue::Object>(message.data.value);
                    std::cout << "VALUE " << std::get<double>(data.at("value").value) << std::endl;
                } else if (message.event == "test:done")
                    return 0;
                else
                    client.send(message);
            }
            for (const auto& action : host->takeDiagnosticActions())
                if (action.kind == arrange::quickjs::QuickJsDiagnosticActionKind::RequestReload) client.requestReload();
            for (const auto& diagnostic : host->takeDiagnosticEvents())
                if (diagnostic.level == arrange::quickjs::QuickJsDiagnosticLevel::Error) {
                    std::cerr << diagnostic.message << std::endl;
                    return 1;
                }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    std::cerr << "live integration timed out" << std::endl;
    return 1;
}
