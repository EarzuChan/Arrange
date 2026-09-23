#pragma once

#include <sstream>
#include <chrono>
#include <string>
#include <string_view>
#include <utility>

namespace arrange {
    enum class LogLevel { Verbose, Debug, Info, Warn, Error };

    class Log final {
       public:
        template <typename... Args>
        static void v(std::string_view tag, Args&&... args) { write(LogLevel::Verbose, tag, join(std::forward<Args>(args)...)); }
        template <typename... Args>
        static void d(std::string_view tag, Args&&... args) { write(LogLevel::Debug, tag, join(std::forward<Args>(args)...)); }
        template <typename... Args>
        static void i(std::string_view tag, Args&&... args) { write(LogLevel::Info, tag, join(std::forward<Args>(args)...)); }
        template <typename... Args>
        static void w(std::string_view tag, Args&&... args) { write(LogLevel::Warn, tag, join(std::forward<Args>(args)...)); }
        template <typename... Args>
        static void e(std::string_view tag, Args&&... args) { write(LogLevel::Error, tag, join(std::forward<Args>(args)...)); }

        static void write(LogLevel level, std::string_view tag, std::string message);
        static std::string format(LogLevel level, std::string_view tag, std::string_view message, std::chrono::system_clock::time_point timestamp, bool colors = false);

       private:
        template <typename... Args>
        static std::string join(Args&&... args) {
            std::ostringstream out;
            bool first = true;
            ((out << (first ? "" : " ") << std::forward<Args>(args), first = false), ...);
            return out.str();
        }
    };
}
