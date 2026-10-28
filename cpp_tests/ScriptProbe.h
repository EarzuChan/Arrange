#pragma once

#include <arrange/quickjs/QuickJsScriptHost.h>

#include <string>

namespace test_support {
    // 夹具脚本以 probe(value) 报告回调已执行：const probe = value => n.diagnosticsToast('i', 'probe', String(value), [], false)
    class ScriptProbe {
       public:
        // 最近一次报告的值；没有新报告时保持上次的值
        const std::string& read(arrange::quickjs::QuickJsScriptHost& host) {
            for (const auto& toast : host.takeDiagnosticToasts())
                if (toast.tag == "probe") value_ = toast.title;
            return value_;
        }

       private:
        std::string value_;
    };
}
