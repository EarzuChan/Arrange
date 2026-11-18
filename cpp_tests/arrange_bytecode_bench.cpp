#include <quickjs.h>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
    std::string read(const char* path) {
        std::ifstream input(path, std::ios::binary);
        if (!input) throw std::runtime_error("无法读取输入");
        return {std::istreambuf_iterator<char>(input), {}};
    }

    void report(const char* label, std::vector<double> times) {
        std::sort(times.begin(), times.end());
        std::cout << label << " P50=" << times[times.size() / 2] << " ms P95=" << times[times.size() * 95 / 100] << " ms\n";
    }
}

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    try {
        const auto source = read(argv[1]);
        const auto bytecode = read(argv[2]);
        std::vector<double> compile, restore;
        for (int i = 0; i < 123; ++i) {
            for (const bool fromBytecode : {i % 2 == 0, i % 2 != 0}) {
                auto* runtime = JS_NewRuntime();
                auto* context = JS_NewContext(runtime);
                const auto start = std::chrono::steady_clock::now();
                const auto object = fromBytecode ? JS_ReadObject(context, reinterpret_cast<const uint8_t*>(bytecode.data()), bytecode.size(), JS_READ_OBJ_BYTECODE) : JS_Eval(context, source.data(), source.size(), "app.js", JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
                const auto elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
                const auto valid = JS_VALUE_GET_TAG(object) == JS_TAG_MODULE;
                JS_FreeValue(context, object);
                JS_FreeContext(context);
                JS_FreeRuntime(runtime);
                if (!valid) throw std::runtime_error("输入无法编译或反序列化为 ESM 模块");
                if (i >= 3) (fromBytecode ? restore : compile).push_back(elapsed);
            }
        }
        report("compile", compile);
        report("deserialize", restore);
        std::cout << "source=" << source.size() << " bytes bytecode=" << bytecode.size() << " bytes\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
