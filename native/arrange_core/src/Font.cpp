#include <arrange/core/Font.h>

#include <algorithm>

namespace arrange::core {
    namespace {
        // 同一字形集合里按 CSS 次序取字重最近者
        std::optional<std::size_t> nearestWeight(std::span<const FontFaceInfo> faces, const std::vector<std::size_t>& candidates, int weight) {
            if (candidates.empty()) return std::nullopt;
            for (const auto index : candidates)
                if (faces[index].weight == weight) return index;
            // 候选里的最近者：在给定方向上取离目标最近的
            const auto pick = [&](bool ascending, int from, int to) -> std::optional<std::size_t> {
                std::optional<std::size_t> best;
                for (const auto index : candidates) {
                    const auto value = faces[index].weight;
                    if (value < from || value > to) continue;
                    if (!best || (ascending ? value < faces[*best].weight : value > faces[*best].weight)) best = index;
                }
                return best;
            };
            constexpr int unbounded = 100000;
            if (weight >= 400 && weight <= 500) {
                if (const auto found = pick(true, weight, 500)) return found;
                if (const auto found = pick(false, 0, weight)) return found;
                return pick(true, 500, unbounded);
            }
            if (weight < 400) {
                if (const auto found = pick(false, 0, weight)) return found;
                return pick(true, weight, unbounded);
            }
            if (const auto found = pick(true, weight, unbounded)) return found;
            return pick(false, 0, weight);
        }
    }

    FontFaceChoice selectFontFace(std::span<const FontFaceInfo> faces, int weight, bool italic, bool synthesis) {
        FontFaceChoice choice;
        if (faces.empty()) return choice;
        weight = clampFontWeight(weight);
        std::vector<std::size_t> preferred, other;
        for (std::size_t index = 0; index < faces.size(); ++index) (faces[index].italic == italic ? preferred : other).push_back(index);
        // 请求斜体时先找斜体与倾斜体，没有再用正体；请求正体时反之
        const auto& pool = preferred.empty() ? other : preferred;
        const auto picked = nearestWeight(faces, pool, weight);
        if (!picked) return choice;
        choice.found = true;
        choice.index = *picked;
        const auto& face = faces[*picked];
        if (synthesis) {
            choice.syntheticBold = weight >= syntheticBoldThreshold && face.weight < syntheticBoldThreshold;
            choice.syntheticItalic = italic && !face.italic;
        }
        return choice;
    }

    namespace {
        std::uint16_t be16(std::span<const std::uint8_t> bytes, std::size_t offset) {
            return static_cast<std::uint16_t>((bytes[offset] << 8) | bytes[offset + 1]);
        }

        std::uint32_t be32(std::span<const std::uint8_t> bytes, std::size_t offset) {
            return (static_cast<std::uint32_t>(bytes[offset]) << 24) | (static_cast<std::uint32_t>(bytes[offset + 1]) << 16) | (static_cast<std::uint32_t>(bytes[offset + 2]) << 8) | bytes[offset + 3];
        }

        bool tagIs(std::span<const std::uint8_t> bytes, std::size_t offset, const char (&tag)[5]) {
            return bytes[offset] == static_cast<std::uint8_t>(tag[0]) && bytes[offset + 1] == static_cast<std::uint8_t>(tag[1]) && bytes[offset + 2] == static_cast<std::uint8_t>(tag[2]) && bytes[offset + 3] == static_cast<std::uint8_t>(tag[3]);
        }
    }

    std::optional<FontFaceInfo> readFontFaceInfo(std::span<const std::uint8_t> bytes) {
        std::size_t base = 0;
        if (bytes.size() >= 16 && tagIs(bytes, 0, "ttcf")) {
            // 字体集合取第一个字体
            base = be32(bytes, 12);
            if (base + 12 > bytes.size()) return std::nullopt;
        }
        if (bytes.size() < base + 12) return std::nullopt;
        const auto version = be32(bytes, base);
        const auto isSfnt = version == 0x00010000u || version == 0x4F54544Fu || version == 0x74727565u;
        if (!isSfnt) return std::nullopt;
        const auto tables = be16(bytes, base + 4);
        std::optional<std::size_t> os2, head;
        for (std::size_t index = 0; index < tables; ++index) {
            const auto entry = base + 12 + index * 16;
            if (entry + 16 > bytes.size()) return std::nullopt;
            const auto offset = be32(bytes, entry + 8);
            const auto length = be32(bytes, entry + 12);
            if (static_cast<std::uint64_t>(offset) + length > bytes.size()) continue;
            if (tagIs(bytes, entry, "OS/2") && length >= 64) os2 = offset;
            if (tagIs(bytes, entry, "head") && length >= 46) head = offset;
        }
        FontFaceInfo info;
        if (os2) {
            const int weight = be16(bytes, *os2 + 4);
            info.weight = weight == 0 ? defaultFontWeight : clampFontWeight(weight);
            const auto selection = be16(bytes, *os2 + 62);
            // bit0 为 italic，bit9 为 oblique
            info.italic = (selection & 0x0001u) != 0 || (selection & 0x0200u) != 0;
        } else if (head) {
            const auto macStyle = be16(bytes, *head + 44);
            info.weight = (macStyle & 0x0001u) != 0 ? 700 : defaultFontWeight;
            info.italic = (macStyle & 0x0002u) != 0;
        }
        return info;
    }

    namespace {
        constexpr char kNewline = fontFamilySeparator;
    }

    std::vector<std::string> splitFontFamilies(std::string_view joined) {
        std::vector<std::string> result;
        std::size_t start = 0;
        while (start <= joined.size()) {
            const auto end = joined.find(kNewline, start);
            const auto part = joined.substr(start, end == std::string_view::npos ? std::string_view::npos : end - start);
            if (!part.empty()) result.emplace_back(part);
            if (end == std::string_view::npos) break;
            start = end + 1;
        }
        return result;
    }

    std::string joinFontFamilies(const std::vector<std::string>& families) {
        std::string result;
        for (const auto& family : families) {
            if (!result.empty()) result += kNewline;
            result += family;
        }
        return result;
    }

    std::string foldFontFamilyName(std::string_view name) {
        std::string result(name);
        std::transform(result.begin(), result.end(), result.begin(), [](unsigned char ch) { return ch >= 'A' && ch <= 'Z' ? static_cast<char>(ch + 32) : static_cast<char>(ch); });
        return result;
    }

    FontRegistry& FontRegistry::shared() {
        static FontRegistry registry;
        return registry;
    }

    void FontRegistry::define(const void* owner, FontFamilyDefinition family) {
        const auto key = foldFontFamilyName(family.name);
        {
            const std::scoped_lock lock(mutex_);
            families_[key] = Entry{owner, std::make_shared<const FontFamilyDefinition>(std::move(family))};
        }
        notifyChanged();
    }

    void FontRegistry::removeOwned(const void* owner) {
        bool changed = false;
        {
            const std::scoped_lock lock(mutex_);
            for (auto it = families_.begin(); it != families_.end();) {
                if (it->second.owner == owner) {
                    it = families_.erase(it);
                    changed = true;
                } else
                    ++it;
            }
        }
        if (changed) notifyChanged();
    }

    void FontRegistry::remove(const void* owner, std::string_view name) {
        bool changed = false;
        {
            const std::scoped_lock lock(mutex_);
            const auto found = families_.find(foldFontFamilyName(name));
            if (found != families_.end() && found->second.owner == owner) {
                families_.erase(found);
                changed = true;
            }
        }
        if (changed) notifyChanged();
    }

    std::shared_ptr<const FontFamilyDefinition> FontRegistry::find(std::string_view name) const {
        const std::scoped_lock lock(mutex_);
        const auto found = families_.find(foldFontFamilyName(name));
        return found == families_.end() ? nullptr : found->second.family;
    }
}
