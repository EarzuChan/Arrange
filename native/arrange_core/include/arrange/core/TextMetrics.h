#pragma once

#include <algorithm>
#include <cstdint>
#include <string_view>

namespace arrange::core {
    inline bool isCombiningCodepoint(char32_t codepoint) noexcept {
        return (codepoint >= 0x0300 && codepoint <= 0x036f) ||
            (codepoint >= 0x1ab0 && codepoint <= 0x1aff) ||
            (codepoint >= 0x1dc0 && codepoint <= 0x1dff) ||
            (codepoint >= 0x20d0 && codepoint <= 0x20ff) ||
            (codepoint >= 0xfe20 && codepoint <= 0xfe2f);
    }

    inline bool isWideCodepoint(char32_t codepoint) noexcept {
        return (codepoint >= 0x1100 && codepoint <= 0x115f) ||
            (codepoint >= 0x2329 && codepoint <= 0x232a) ||
            (codepoint >= 0x2e80 && codepoint <= 0xa4cf) ||
            (codepoint >= 0xac00 && codepoint <= 0xd7a3) ||
            (codepoint >= 0xf900 && codepoint <= 0xfaff) ||
            (codepoint >= 0xfe10 && codepoint <= 0xfe19) ||
            (codepoint >= 0xfe30 && codepoint <= 0xfe6f) ||
            (codepoint >= 0xff00 && codepoint <= 0xff60) ||
            (codepoint >= 0xffe0 && codepoint <= 0xffe6) ||
            (codepoint >= 0x1f300 && codepoint <= 0x1faff);
    }

    inline char32_t decodeUtf8Codepoint(std::string_view text, std::size_t& index) noexcept {
        const auto current = static_cast<unsigned char>(text[index]);
        if (current < 0x80) {
            ++index;
            return current;
        }

        auto hasContinuation = [&](std::size_t offset) {
            return index + offset < text.size() &&
                (static_cast<unsigned char>(text[index + offset]) & 0xc0u) == 0x80u;
        };

        if ((current & 0xe0u) == 0xc0u && hasContinuation(1)) {
            const auto codepoint =
                ((current & 0x1fu) << 6u) |
                (static_cast<unsigned char>(text[index + 1]) & 0x3fu);
            index += 2;
            return static_cast<char32_t>(codepoint);
        }

        if ((current & 0xf0u) == 0xe0u && hasContinuation(1) && hasContinuation(2)) {
            const auto codepoint =
                ((current & 0x0fu) << 12u) |
                ((static_cast<unsigned char>(text[index + 1]) & 0x3fu) << 6u) |
                (static_cast<unsigned char>(text[index + 2]) & 0x3fu);
            index += 3;
            return static_cast<char32_t>(codepoint);
        }

        if ((current & 0xf8u) == 0xf0u &&
            hasContinuation(1) &&
            hasContinuation(2) &&
            hasContinuation(3)) {
            const auto codepoint =
                ((current & 0x07u) << 18u) |
                ((static_cast<unsigned char>(text[index + 1]) & 0x3fu) << 12u) |
                ((static_cast<unsigned char>(text[index + 2]) & 0x3fu) << 6u) |
                (static_cast<unsigned char>(text[index + 3]) & 0x3fu);
            index += 4;
            return static_cast<char32_t>(codepoint);
        }

        ++index;
        return 0xfffd;
    }

    inline float textCodepointAdvance(char32_t codepoint, float fontSize) noexcept {
        if (codepoint == U'\r') return 0.0f;
        if (codepoint == U'\t') return fontSize * 2.4f;
        if (isCombiningCodepoint(codepoint)) return 0.0f;
        return fontSize * (isWideCodepoint(codepoint) ? 1.0f : 0.6f);
    }

} // namespace arrange::core
