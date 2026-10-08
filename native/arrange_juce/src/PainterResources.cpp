#include <arrange/juce/PainterResources.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/AppResolver.h>
#include <stdexcept>
#include <cmath>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <array>

namespace arrange::juce {
    namespace {
        struct PainterPayload {
            ::juce::MemoryBlock bytes;
            bool svg = false;
            std::string source;
        };

        struct HttpAddress {
            std::string origin;
            std::string path;
        };

        class PainterWorkers final : public ::juce::DeletedAtShutdown {
           public:
            static ::juce::ThreadPool& get() {
                return holder_.get()->workers_;
            }

            ~PainterWorkers() override {
                holder_.clear(this);
            }

           private:
            PainterWorkers() = default;
            ::juce::ThreadPool workers_{2};
            static inline ::juce::SingletonHolder<PainterWorkers, ::juce::CriticalSection, false> holder_;
            friend struct ::juce::SingletonHolder<PainterWorkers, ::juce::CriticalSection, false>;
        };

        HttpAddress parseHttpAddress(const std::string& address) {
            const auto separator = address.find("://");
            if (separator == std::string::npos) throw std::runtime_error("Live Painter 地址必须使用 HTTP 或 HTTPS");
            const auto scheme = ::juce::String(address.substr(0, separator)).toLowerCase().toStdString();
            if (scheme != "http" && scheme != "https") throw std::runtime_error("Live Painter 地址必须使用 HTTP 或 HTTPS");
            const auto authorityEnd = address.find_first_of("/?#", separator + 3);
            auto authority = address.substr(separator + 3, authorityEnd == std::string::npos ? std::string::npos : authorityEnd - separator - 3);
            if (authority.empty() || authority.find_first_of("@\\ \t\r\n%") != std::string::npos) throw std::runtime_error("Live Painter 服务 origin 无效");
            authority = ::juce::String(authority).toLowerCase().toStdString();
            const auto defaultPort = scheme == "https" ? ":443" : ":80";
            if (authority.ends_with(defaultPort)) authority.resize(authority.size() - std::char_traits<char>::length(defaultPort));
            auto path = authorityEnd == std::string::npos ? "/" : address.substr(authorityEnd);
            if (path.starts_with('?')) path.insert(0, "/");
            return {scheme + "://" + authority, std::move(path)};
        }

        int hexDigit(char value) {
            if (value >= '0' && value <= '9') return value - '0';
            if (value >= 'a' && value <= 'f') return value - 'a' + 10;
            if (value >= 'A' && value <= 'F') return value - 'A' + 10;
            return -1;
        }

        std::string percentDecode(std::string_view value) {
            std::string result;
            result.reserve(value.size());
            for (std::size_t index = 0; index < value.size(); ++index) {
                if (value[index] != '%')
                    result += value[index];
                else {
                    if (index + 2 >= value.size() || hexDigit(value[index + 1]) < 0 || hexDigit(value[index + 2]) < 0) throw std::runtime_error("Painter 资源含有无效的百分号编码");
                    result += static_cast<char>((hexDigit(value[index + 1]) << 4) | hexDigit(value[index + 2]));
                    index += 2;
                }
            }
            return result;
        }

        std::string liveResourceAddress(const HttpAddress& server, const std::string& resource) {
            if (resource.size() > 8192) throw std::runtime_error("Live Painter 资源地址过长");
            if (resource.empty() || resource.starts_with("//") || resource.find_first_of("\\#\r\n\t") != std::string::npos) throw std::runtime_error("Live Painter 资源地址无效：" + resource);
            std::string path;
            if (resource.find("://") != std::string::npos) {
                const auto absolute = parseHttpAddress(resource);
                if (absolute.origin != server.origin) throw std::runtime_error("Live Painter 禁止跨 origin 资源：" + resource);
                path = absolute.path;
            } else {
                if (resource.find(':') != std::string::npos) throw std::runtime_error("Live Painter 禁止文件路径或非 HTTP 资源：" + resource);
                path = resource.starts_with('/') ? resource : "/" + resource;
            }
            const auto decoded = percentDecode(path.substr(0, path.find('?')));
            if (decoded.find_first_of("\\:") != std::string::npos || decoded.starts_with("//")) throw std::runtime_error("Live Painter 禁止文件路径：" + resource);
            for (std::size_t index = 0; index < decoded.size(); ++index)
                if (static_cast<unsigned char>(decoded[index]) < 32 || decoded[index] == 127) throw std::runtime_error("Live Painter 资源路径含有控制字符");
            std::size_t start = 0;
            while (start <= decoded.size()) {
                const auto end = decoded.find('/', start);
                const auto segment = decoded.substr(start, end == std::string::npos ? std::string::npos : end - start);
                if (segment == "..") throw std::runtime_error("Live Painter 资源路径禁止越界：" + resource);
                if (end == std::string::npos) break;
                start = end + 1;
            }
            std::string escaped;
            constexpr const char* digits = "0123456789ABCDEF";
            for (const auto value : path) {
                const auto byte = static_cast<unsigned char>(value);
                if (byte >= 128 || byte == ' ') {
                    escaped += '%';
                    escaped += digits[byte >> 4];
                    escaped += digits[byte & 15];
                } else
                    escaped += value;
            }
            return server.origin + escaped;
        }

        PainterPayload dataPayload(const std::string& resource, const PainterResourceLimits& limits) {
            const auto comma = resource.find(',');
            if (comma == std::string::npos) throw std::runtime_error("Painter data URL 缺少内容");
            auto type = ::juce::String(resource.substr(5, comma - 5)).toLowerCase().toStdString();
            const bool base64 = type.ends_with(";base64");
            if (base64) type.resize(type.size() - 7);
            if (type != "image/svg+xml" && type != "image/png" && type != "image/jpeg" && type != "image/gif") throw std::runtime_error("Painter data URL 只支持 SVG、PNG、JPEG 或 GIF 图片");
            const auto body = resource.substr(comma + 1);
            if (body.size() > limits.maxBytes * (base64 ? 2 : 3)) throw std::runtime_error("Painter data URL 超出资源字节预算");
            PainterPayload result;
            result.svg = type == "image/svg+xml";
            if (base64) {
                ::juce::MemoryOutputStream output(result.bytes, false);
                if (!::juce::Base64::convertFromBase64(output, ::juce::String(body))) throw std::runtime_error("Painter data URL 的 base64 内容无效");
            } else {
                const auto decoded = percentDecode(body);
                result.bytes.append(decoded.data(), decoded.size());
            }
            if (result.bytes.getSize() > limits.maxBytes) throw std::runtime_error("Painter data URL 超出资源字节预算");
            return result;
        }

        PainterPayload httpPayload(const std::string& address, const PainterResourceLimits& limits) {
            const auto expiresAt = std::chrono::steady_clock::now() + std::chrono::milliseconds(limits.timeoutMs);
            ::juce::WebInputStream stream(::juce::URL(::juce::String(address)), false);
            stream.withConnectionTimeout(limits.timeoutMs).withNumRedirectsToFollow(0).withExtraHeaders("Cache-Control: no-cache\r\n");
            std::atomic<bool> expired = false;
            std::mutex mutex;
            std::condition_variable_any condition;
            // 总时限覆盖连接和阻塞读取，结束时先停止看门线程再销毁 stream
            std::jthread deadline([&](std::stop_token stop) {
                std::unique_lock lock(mutex);
                condition.wait_until(lock, stop, expiresAt, [] { return false; });
                if (!stop.stop_requested()) {
                    expired = true;
                    stream.cancel();
                }
            });
            const auto timedOut = [&] {
                return expired || std::chrono::steady_clock::now() >= expiresAt;
            };
            const auto fail = [&](const std::string& reason) -> void {
                throw std::runtime_error("Live Painter 读取失败：" + address + "：" + (timedOut() ? "请求超时" : reason));
            };
            if (!stream.connect(nullptr)) fail("连接失败");
            const auto status = stream.getStatusCode();
            if (status != 200) fail("HTTP " + std::to_string(status));
            const auto length = stream.getTotalLength();
            if (length > static_cast<::juce::int64>(limits.maxBytes)) fail("HTTP 200，响应超出资源字节预算");
            const auto mime = stream.getResponseHeaders()["Content-Type"].upToFirstOccurrenceOf(";", false, false).trim().toLowerCase();
            if (mime.isNotEmpty() && !mime.startsWith("image/") && mime != "application/octet-stream") fail("HTTP 200，资源 MIME 不支持：" + mime.toStdString());
            PainterPayload result;
            result.source = address + "（HTTP 200）";
            const auto path = ::juce::String(address.substr(0, address.find('?'))).toLowerCase();
            result.svg = mime == "image/svg+xml" || path.endsWith(".svg");
            std::array<char, 8192> buffer;
            while (!stream.isExhausted()) {
                const auto count = stream.read(buffer.data(), static_cast<int>(buffer.size()));
                if (timedOut()) fail("请求超时");
                if (count <= 0) {
                    if (stream.isError()) fail("HTTP 200，响应读取失败");
                    break;
                }
                if (result.bytes.getSize() + static_cast<std::size_t>(count) > limits.maxBytes) fail("HTTP 200，响应超出资源字节预算");
                result.bytes.append(buffer.data(), static_cast<std::size_t>(count));
            }
            if (timedOut()) fail("请求超时");
            if (length >= 0 && result.bytes.getSize() != static_cast<std::size_t>(length)) fail("HTTP 200，响应内容不完整");
            return result;
        }

        float svgLength(const ::juce::String& value, float fallback) {
            const auto text = value.trim();
            if (text.isEmpty() || text.endsWithChar('%')) return fallback;
            auto result = text.getFloatValue();
            if (text.endsWithIgnoreCase("in"))
                result *= 96.0f;
            else if (text.endsWithIgnoreCase("cm"))
                result *= 96.0f / 2.54f;
            else if (text.endsWithIgnoreCase("mm"))
                result *= 96.0f / 25.4f;
            else if (text.endsWithIgnoreCase("pt"))
                result *= 96.0f / 72.0f;
            else if (text.endsWithIgnoreCase("pc"))
                result *= 16.0f;
            if (!std::isfinite(result) || result <= 0.0f) throw std::runtime_error("Painter SVG 视口尺寸必须是正有限数");
            return result;
        }

        void validateSvgReferences(const ::juce::XmlElement& element, const std::string& source) {
            for (const auto* attribute : {"href", "xlink:href"}) {
                const auto reference = element.getStringAttribute(attribute);
                if (reference.isEmpty() || reference.startsWithChar('#')) continue;
                if (!reference.startsWith("data:")) throw std::runtime_error("Painter SVG 禁止外部资源引用：" + source);
                (void)dataPayload(reference.toStdString(), PainterResourceLimits{});
            }
            for (auto* child = element.getFirstChildElement(); child; child = child->getNextElement()) validateSvgReferences(*child, source);
        }

        std::shared_ptr<JucePainterContent> decodePainter(const PainterPayload& payload, const std::string& resource) {
            const auto& source = payload.source.empty() ? resource : payload.source;
            auto content = std::make_shared<JucePainterContent>();
            if (payload.svg) {
                const auto xmlText = ::juce::String::fromUTF8(static_cast<const char*>(payload.bytes.getData()), static_cast<int>(payload.bytes.getSize()));
                if (xmlText.containsIgnoreCase("<!DOCTYPE") || xmlText.containsIgnoreCase("<!ENTITY")) throw std::runtime_error("Painter SVG 不支持 DTD 或外部实体：" + source);
                auto xml = ::juce::XmlDocument::parse(xmlText);
                if (!xml || !xml->hasTagName("svg")) throw std::runtime_error("Painter SVG 内容无法解析：" + source);
                validateSvgReferences(*xml, source);
                const auto viewBox = ::juce::StringArray::fromTokens(xml->getStringAttribute("viewBox"), " ,\t\r\n", "");
                const auto width = svgLength(xml->getStringAttribute("width"), viewBox.size() == 4 ? viewBox[2].getFloatValue() : 300.0f);
                const auto height = svgLength(xml->getStringAttribute("height"), viewBox.size() == 4 ? viewBox[3].getFloatValue() : 150.0f);
                if (!std::isfinite(width) || !std::isfinite(height) || width <= 0.0f || height <= 0.0f) throw std::runtime_error("Painter SVG 视口无效：" + source);
                xml->setAttribute("width", width);
                xml->setAttribute("height", height);
                // Drawable 解析会触发 Component setter，只在解析期间取得消息线程锁
                {
                    const ::juce::MessageManagerLock lock(::juce::ThreadPoolJob::getCurrentThreadPoolJob());
                    if (!lock.lockWasGained()) throw std::runtime_error("Painter SVG 解析已取消：" + source);
                    content->vector = ::juce::Drawable::createFromSVG(*xml);
                }
                if (!content->vector) throw std::runtime_error("Painter SVG 未产生可绘制内容：" + source);
                content->vectorViewport = {0, 0, width, height};
                content->intrinsicSize = arrange::core::Size{width, height};
            } else {
                content->image = ::juce::ImageFileFormat::loadFrom(payload.bytes.getData(), payload.bytes.getSize());
                if (!content->image.isValid()) throw std::runtime_error("Painter 图片无法解码：" + source);
                content->intrinsicSize = arrange::core::Size{static_cast<float>(content->image.getWidth()), static_cast<float>(content->image.getHeight())};
            }
            return content;
        }

        arrange::core::PainterLoader asynchronousPainterLoader(std::function<PainterPayload(const std::string&)> read) {
            return [read = std::move(read)](const std::string& resource, std::function<void()> wake) {
                // 工作线程只持有不可变来源配置和完成结果，不持有 QuickJS 上下文或 UI 树
                auto result = std::make_shared<std::promise<arrange::core::PainterLoadResult>>();
                auto future = result->get_future();
                // JUCE GUI 关闭时先收回 worker，再销毁消息线程和网络平台对象
                PainterWorkers::get().addJob([result, read, resource, wake = std::move(wake)] {
#if JUCE_MAC || JUCE_IOS
                    // 每次请求独立释放 macOS 临时对象，不能拖到静态线程池退出
                    const ::juce::ScopedAutoReleasePool requestPool;
#endif
                    arrange::core::PainterLoadResult loaded;
                    try {
                        loaded.content = decodePainter(read(resource), resource.substr(0, 512));
                    } catch (const std::exception& error) {
                        loaded.error = error.what();
                    }
                    result->set_value(std::move(loaded));
                    if (wake) wake();
                });
                return future;
            };
        }
    }

    arrange::core::PainterLoader packagePainterLoader(std::filesystem::path packageDir) {
        return asynchronousPainterLoader([packageDir = std::move(packageDir)](const std::string& resource) {
            if (resource.starts_with("data:")) return dataPayload(resource, PainterResourceLimits{});
            const auto resolved = arrange::resolvePackageResource(packageDir, resource);
            if (!resolved.ok) throw std::runtime_error(resolved.error);
            PainterPayload result;
            const auto fileName = resolved.path.u8string();
            const ::juce::File file(::juce::String::fromUTF8(reinterpret_cast<const char*>(fileName.data()), static_cast<int>(fileName.size())));
            if (!file.loadFileAsData(result.bytes)) throw std::runtime_error("Painter 资源读取失败：" + resource);
            result.svg = file.hasFileExtension("svg");
            return result;
        });
    }

    arrange::core::PainterLoader livePainterLoader(std::string devServerUrl, PainterResourceLimits limits) {
        if (limits.maxBytes == 0 || limits.maxBytes > PainterResourceLimits::MaxResourceBytes || limits.timeoutMs <= 0 || limits.timeoutMs > PainterResourceLimits::MaxTimeoutMs) throw std::invalid_argument("Live Painter 资源限制无效");
        const auto server = parseHttpAddress(devServerUrl);
        return asynchronousPainterLoader([server, limits](const std::string& resource) {
            if (resource.starts_with("data:")) return dataPayload(resource, limits);
            return httpPayload(liveResourceAddress(server, resource), limits);
        });
    }
}

#endif
