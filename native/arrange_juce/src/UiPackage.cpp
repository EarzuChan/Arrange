#include <arrange/quickjs/QuickJsBuild.h>
#include <arrange/juce/UiPackage.h>
#include <arrange/core/Version.h>
#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>

#include <charconv>
#include <array>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <unordered_map>
#if JUCE_WINDOWS
#include <windows.h>
#endif

namespace arrange::juce {
    namespace {
        constexpr std::string_view manifestName = "arrange-ui.json";
        constexpr std::size_t manifestLimit = 4 * 1024 * 1024;
        constexpr int entryCountLimit = 8192;

        std::filesystem::path utf8Path(std::string_view name) {
            return std::filesystem::path(std::u8string(name.begin(), name.end()));
        }

        ::juce::String text(std::string_view name) {
            return ::juce::String::fromUTF8(name.data(), static_cast<int>(name.size()));
        }

        [[noreturn]] void fail(std::string_view reason, std::string_view name = {}) {
            throw std::runtime_error("UI 包：" + std::string(reason) + (name.empty() ? "" : "：" + std::string(name)));
        }

        bool portableName(std::string_view name) {
            if (name.empty() || name.size() > 1024 || !::juce::CharPointer_UTF8::isValidString(name.data(), static_cast<int>(name.size()))) return false;
            for (const unsigned char c : name)
                if (c < 32 || c == 127 || std::string_view("\\:*?\"<>|").find(static_cast<char>(c)) != std::string_view::npos) return false;
            while (true) {
                const auto slash = name.find('/');
                const auto part = name.substr(0, slash);
                if (part.empty() || part.back() == '.' || part.back() == ' ') return false;
                const auto stem = text(part.substr(0, part.find('.'))).toLowerCase();
                if (stem == "con" || stem == "prn" || stem == "aux" || stem == "nul" || ((stem.startsWith("com") || stem.startsWith("lpt")) && stem.length() == 4 && ::juce::String::fromUTF8("123456789¹²³").containsChar(stem[3]))) return false;
                if (slash == std::string_view::npos) return true;
                name.remove_prefix(slash + 1);
            }
        }

        bool redirected(const std::filesystem::path& path) {
#if JUCE_WINDOWS
            const auto flags = GetFileAttributesW(path.c_str());
            return flags != INVALID_FILE_ATTRIBUTES && (flags & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
#else
            return std::filesystem::is_symlink(std::filesystem::symlink_status(path));
#endif
        }

        int verifyZipIndex(::juce::InputStream& input) {
            // JUCE 管理条目流；先核对 Arrange 支持的 ZIP 子集，并限制其索引分配量。
            const auto length = input.getTotalLength();
            const auto readAt = [&](::juce::int64 offset, void* buffer, int size) {
                if (!input.setPosition(offset) || input.read(buffer, size) != size) fail("ZIP 索引截断");
            };
            std::array<unsigned char, 22> end;
            readAt(length - end.size(), end.data(), static_cast<int>(end.size()));
            const auto u16 = ::juce::ByteOrder::littleEndianShort;
            const auto u32 = ::juce::ByteOrder::littleEndianInt;
            const int count = u16(end.data() + 10);
            const ::juce::int64 size = u32(end.data() + 12);
            const ::juce::int64 start = u32(end.data() + 16);
            if (u32(end.data()) != 0x06054b50 || u32(end.data() + 4) || u16(end.data() + 8) != count || u16(end.data() + 20) || count < 1 || count > entryCountLimit + 1 || size > 16 * 1024 * 1024 || start + size != length - 22) fail("ZIP 目录无效（不支持 ZIP64、分卷或归档注释）");
            auto position = start;
            for (int i = 0; i < count; ++i) {
                std::array<unsigned char, 46> header;
                readAt(position, header.data(), static_cast<int>(header.size()));
                const auto flags = u16(header.data() + 8);
                const auto method = u16(header.data() + 10);
                const auto nameLength = u16(header.data() + 28);
                const auto compressed = u32(header.data() + 20);
                const auto localOffset = u32(header.data() + 42);
                if (u32(header.data()) != 0x02014b50 || flags & ~0x080e || (method != 0 && method != 8) || !nameLength || nameLength > 1024 || u16(header.data() + 34) || u32(header.data() + 24) > core::UiEntryLimit || localOffset + 30ULL > static_cast<std::uint64_t>(start)) fail("ZIP 包含不支持或损坏的条目");
                std::array<unsigned char, 30> local;
                readAt(localOffset, local.data(), static_cast<int>(local.size()));
                if (u32(local.data()) != 0x04034b50 || u16(local.data() + 6) != flags || u16(local.data() + 8) != method || u16(local.data() + 26) != nameLength || localOffset + 30ULL + nameLength + u16(local.data() + 28) + compressed > static_cast<std::uint64_t>(start)) fail("ZIP 条目头不匹配");
                std::string name(nameLength, '\0');
                std::string localName(nameLength, '\0');
                readAt(position + 46, name.data(), nameLength);
                readAt(localOffset + 30, localName.data(), nameLength);
                if (!portableName(name) || name != localName) fail("ZIP 条目名不匹配", name);
                position += 46 + nameLength + u16(header.data() + 30) + u16(header.data() + 32);
                if (position > length - 22) fail("ZIP 索引越界");
            }
            if (position != length - 22) fail("ZIP 索引长度不匹配");
            return count;
        }

        struct Entry {
            core::UiEntryKind kind;
            std::size_t size;
            std::string hash;
            std::string file;
        };

        class FileUiPackage final : public core::UiPackage {
           public:
            explicit FileUiPackage(const std::filesystem::path& path) {
                if (redirected(path)) fail("包落点不能是链接");
                if (std::filesystem::is_directory(path))
                    root_ = std::filesystem::canonical(path);
                else if (std::filesystem::is_regular_file(path)) {
                    const auto encoded = path.u8string();
                    const ::juce::File file(text(std::string_view(reinterpret_cast<const char*>(encoded.data()), encoded.size())));
                    auto input = file.createInputStream();
                    if (!input || input->getTotalLength() < 22 || input->getTotalLength() >= (1LL << 31)) fail("ZIP 大小或文件无效");
                    const auto count = verifyZipIndex(*input);
                    zip_ = std::make_unique<::juce::ZipFile>(input.release(), true);
                    if (zip_->getNumEntries() != count) fail("ZIP 索引条目不一致");
                    for (int i = 0; i < zip_->getNumEntries(); ++i) {
                        const auto* item = zip_->getEntry(i);
                        const auto name = item->filename.toStdString();
                        if (item->isSymbolicLink || !portableName(name) || !zipEntries_.emplace(name, i).second) fail("ZIP 条目无效或重名", name);
                    }
                } else
                    fail("不存在普通目录或 ZIP 文件");

                const auto json = readPhysical(manifestName, manifestLimit);
                ::juce::var data;
                auto parsed = ::juce::JSON::parse(text(json), data);
                if (json.find('\0') != std::string::npos || parsed.failed() || !data.isObject()) fail("运行时清单无效", manifestName);
                const auto format = data.getProperty("format", {});
                const auto protocol = data.getProperty("protocol", {});
                if (!format.isInt() || static_cast<int>(format) != 2) fail("不支持的 UI 包格式");
                if (!protocol.isInt() || static_cast<int>(protocol) != static_cast<int>(core::RuntimeVersion)) fail("脚本与原生协议不匹配，当前需要 " + std::to_string(core::RuntimeVersion));
                const auto script = data.getProperty("scriptFormat", {});
                if (!script.isString() || (script.toString() != "js" && script.toString() != "bytecode")) fail("脚本表示无效");
                scriptFormat_ = script.toString() == "bytecode" ? core::UiScriptFormat::Bytecode : core::UiScriptFormat::Js;
                const auto engine = data.getProperty("engine", {});
                if (scriptFormat_ == core::UiScriptFormat::Bytecode) {
                    if (!engine.isString() || engine.toString().toStdString() != quickjs::buildIdentity()) fail("QuickJS 字节码构建身份不匹配");
                } else if (data.hasProperty("engine")) {
                    fail("JS 包不能声明字节码引擎");
                }
                const auto rows = data.getProperty("entries", {});
                const auto* array = rows.getArray();
                if (!array || array->isEmpty() || array->size() > entryCountLimit) fail("条目清单无效");
                std::unordered_map<std::string, std::string> names{{std::string(manifestName), std::string(manifestName)}};
                std::unordered_map<std::string, std::string> directories;
                const auto registerName = [](const std::string& name, auto& names, auto& directories) {
                    const auto key = text(name).toLowerCase().toStdString();
                    if (directories.contains(key) || !names.emplace(key, name).second) fail("条目路径冲突", name);
                    for (auto slash = name.find('/'); slash != std::string::npos; slash = name.find('/', slash + 1)) {
                        const auto dir = name.substr(0, slash);
                        const auto folded = text(dir).toLowerCase().toStdString();
                        const auto found = directories.emplace(folded, dir).first;
                        if (names.contains(folded) || found->second != dir) fail("条目目录冲突", dir);
                    }
                };
                auto files = names;
                auto fileDirectories = directories;
                for (const auto& row : *array) {
                    if (!row.isObject()) fail("条目格式无效");
                    const auto pathValue = row.getProperty("path", {});
                    const auto kindValue = row.getProperty("kind", {});
                    const auto shaValue = row.getProperty("sha256", {});
                    if (!pathValue.isString() || !kindValue.isString() || !shaValue.isString()) fail("条目字段类型无效");
                    const auto name = pathValue.toString().toStdString();
                    const auto type = kindValue.toString();
                    const auto size = row.getProperty("size", {});
                    const auto hash = shaValue.toString().toStdString();
                    if (!portableName(name) || (type != "module" && type != "asset") || !size.isInt() || static_cast<int>(size) < 0 || static_cast<std::size_t>(static_cast<int>(size)) > core::UiEntryLimit || hash.size() != 64 || hash.find_first_not_of("0123456789abcdef") != std::string::npos) fail("条目字段无效", name);
                    const auto payload = row.getProperty("file", {});
                    std::string file = name;
                    if (type == "module" && scriptFormat_ == core::UiScriptFormat::Bytecode) {
                        file += ".qbc";
                        if (!portableName(file) || !payload.isString() || payload.toString().toStdString() != file) fail("字节码载荷名无效", name);
                    } else if (row.hasProperty("file")) {
                        fail("条目不能重定向载荷", name);
                    }
                    registerName(name, names, directories);
                    registerName(file, files, fileDirectories);
                    if (zip_) {
                        const auto it = zipEntries_.find(file);
                        if (it == zipEntries_.end() || zip_->getEntry(it->second)->uncompressedSize != static_cast<int>(size)) fail("ZIP 索引与清单不符", name);
                    }
                    entries_.emplace(name, Entry{type == "module" ? core::UiEntryKind::Module : core::UiEntryKind::Asset, static_cast<std::size_t>(static_cast<int>(size)), hash, std::move(file)});
                }
                if (zip_ && zipEntries_.size() != entries_.size() + 1) fail("ZIP 有未登记的条目");
                const auto entryValue = data.getProperty("entry", {});
                if (!entryValue.isString()) fail("入口字段不是字符串");
                entry_ = entryValue.toString().toStdString();
                const auto entry = entries_.find(entry_);
                if (entry == entries_.end() || entry->second.kind != core::UiEntryKind::Module) fail("入口不是已登记模块", entry_);
            }

            core::UiScriptFormat scriptFormat() const noexcept override { return scriptFormat_; }

            std::string_view entry() const noexcept override {
                return entry_;
            }

            std::string read(std::string_view path, core::UiEntryKind kind, std::size_t limit) const override {
                const auto it = entries_.find(std::string(path));
                if (it == entries_.end() || it->second.kind != kind) fail(kind == core::UiEntryKind::Module ? "找不到已登记模块" : "找不到已登记资产", path);
                const auto& entry = it->second;
                if (entry.size > limit) fail("超过读取预算", path);
                auto result = readPhysical(entry.file, entry.size);
                if (result.size() != entry.size || ::juce::SHA256(result.data(), result.size()).toHexString().toStdString() != entry.hash) fail("大小或摘要不匹配", path);
                return result;
            }

           private:
            std::string readPhysical(std::string_view name, std::size_t limit) const {
                if (zip_) {
                    const std::lock_guard lock(zipMutex_);
                    const auto it = zipEntries_.find(std::string(name));
                    if (it == zipEntries_.end()) fail("ZIP 缺少条目", name);
                    const auto size = zip_->getEntry(it->second)->uncompressedSize;
                    if (size < 0 || static_cast<std::uint64_t>(size) > limit) fail("ZIP 条目超过读取预算", name);
                    std::unique_ptr<::juce::InputStream> stream(zip_->createStreamForEntry(it->second));
                    if (!stream) fail("ZIP 条目无法打开", name);
                    std::string result(static_cast<std::size_t>(size), '\0');
                    std::size_t offset = 0;
                    while (offset < result.size()) {
                        const auto read = stream->read(result.data() + offset, static_cast<int>(result.size() - offset));
                        if (read <= 0) fail("ZIP 条目提前结束", name);
                        offset += static_cast<std::size_t>(read);
                    }
                    char extra;
                    if (stream->read(&extra, 1) > 0) fail("ZIP 条目比声明更长", name);
                    return result;
                }
                auto path = root_;
                for (const auto& part : utf8Path(name)) {
                    path /= part;
                    if (redirected(path)) fail("禁止读取链接", name);
                }
                if (!std::filesystem::is_regular_file(path)) fail("找不到普通文件", name);
                const auto size = std::filesystem::file_size(path);
                if (size > limit) fail("超过读取预算", name);
                std::ifstream stream(path, std::ios::binary);
                std::string result(static_cast<std::size_t>(size), '\0');
                if (!stream || !stream.read(result.data(), static_cast<std::streamsize>(size)) || stream.peek() != std::char_traits<char>::eof()) fail("文件读取失败或正在更改", name);
                return result;
            }

            std::filesystem::path root_;
            std::unique_ptr<::juce::ZipFile> zip_;
            mutable std::mutex zipMutex_;
            std::unordered_map<std::string, int> zipEntries_;
            std::unordered_map<std::string, Entry> entries_;
            std::string entry_;
            core::UiScriptFormat scriptFormat_ = core::UiScriptFormat::Js;
        };
    }

    std::shared_ptr<const core::UiPackage> mountUiPackage(const std::filesystem::path& path) {
        return std::make_shared<FileUiPackage>(path);
    }

    std::string packageAssetName(std::string_view reference) {
        if (!reference.starts_with('/')) {
            if (!portableName(reference)) fail("资产逻辑名无效", reference);
            return std::string(reference);
        }
        auto encoded = reference.substr(1);
        encoded = encoded.substr(0, encoded.find_first_of("?#"));
        std::string name;
        for (std::size_t i = 0; i < encoded.size(); ++i) {
            if (encoded[i] != '%')
                name += encoded[i];
            else {
                unsigned int byte = 0;
                if (i + 2 >= encoded.size()) fail("资产 URL 编码无效", reference);
                const auto parsed = std::from_chars(encoded.data() + i + 1, encoded.data() + i + 3, byte, 16);
                if (parsed.ec != std::errc{} || parsed.ptr != encoded.data() + i + 3 || byte == '/') fail("资产 URL 编码无效", reference);
                name += static_cast<char>(byte);
                i += 2;
            }
        }
        if (!portableName(name)) fail("资产 URL 路径无效", reference);
        return name;
    }
}
