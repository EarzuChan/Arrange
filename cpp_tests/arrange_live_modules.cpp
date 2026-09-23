#include <arrange/quickjs/QuickJsScriptHost.h>
#include <iostream>
#include <stdexcept>

using namespace arrange::quickjs;

namespace {
    void require(bool condition, const std::string& message) {
        if (!condition) throw std::runtime_error(message);
    }
}

int main() {
    try {
        QuickJsScriptHost host;
        LiveModuleSnapshot initial{"/entry",
                                   {
                                       {"/entry", "import { count, increment } from './counter'; increment(); globalThis.__ARRANGE_HOT_RECEIVE__ = async message => { const next = await import('/counter?t=2'); if (count !== 2 || next.count !== 20 || message.data.nested[0] !== 7) throw Error('cache or typed message broken'); __ARRANGE_HOT_TRANSPORT__.send('checked', { old: count, next: next.count }); };", {}},
                                       {"/counter", "export let count = 1; export function increment() { count++ }", {}},
                                   }};
        const auto loaded = host.executeLiveModules(initial);
        require(loaded.ok, loaded.error);
        LiveModuleSnapshot update{"", {{"/counter?t=2", "export const count = await Promise.resolve(20)", {}}}};
        HotMessage message;
        message.type = "custom";
        message.data = {HotValue::Object{{"nested", {HotValue::Array{{7.0}}}}}};
        const auto applied = host.applyHotUpdate(update, message);
        require(applied.ok, applied.error);
        const auto responses = host.takeHotMessages();
        require(responses.size() == 1 && responses[0].event == "checked", "missing typed HMR response");
        const auto& data = std::get<HotValue::Object>(responses[0].data.value);
        require(std::get<double>(data.at("old").value) == 2 && std::get<double>(data.at("next").value) == 20, "module versions did not coexist");
        const auto missing = host.applyHotUpdate({}, message);
        require(missing.ok, missing.error);
        std::cout << "Live ESM cache, dynamic import, TLA and typed HMR passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
