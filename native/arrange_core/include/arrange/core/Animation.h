#pragma once

#include "Geometry.h"
#include <algorithm>
#include <array>
#include <cmath>

namespace arrange::core {
    enum class AnimationKind { Tween, Spring, Snap };

    struct AnimationSpec {
        AnimationKind kind = AnimationKind::Spring;
        float durationMillis = 300;
        float delayMillis = 0;
        float stiffness = 400;
        float dampingRatio = 1;
        float threshold = 0.01f;
        std::array<float, 4> bezier{0.4f, 0, 0.2f, 1};
        bool operator==(const AnimationSpec&) const = default;
    };

    inline std::pair<float, float> sampleSpring(float delta, float velocity, double seconds, const AnimationSpec& spec) {
        const double omega = std::sqrt(spec.stiffness), zeta = spec.dampingRatio;
        if (zeta < 1) {
            const auto decay = zeta * omega, frequency = omega * std::sqrt(1 - zeta * zeta);
            const auto b = (velocity + decay * delta) / frequency;
            const auto c = std::cos(frequency * seconds), s = std::sin(frequency * seconds), e = std::exp(-decay * seconds);
            return {static_cast<float>(e * (delta * c + b * s)), static_cast<float>(e * ((b * frequency - decay * delta) * c - (delta * frequency + decay * b) * s))};
        }
        if (std::abs(zeta - 1) < 1e-6) {
            const auto b = velocity + omega * delta, e = std::exp(-omega * seconds);
            return {static_cast<float>(e * (delta + b * seconds)), static_cast<float>(e * (velocity - omega * b * seconds))};
        }
        const auto root = std::sqrt(zeta * zeta - 1), r1 = -omega * (zeta - root), r2 = -omega * (zeta + root);
        const auto a = (velocity - r2 * delta) / (r1 - r2), b = delta - a;
        return {static_cast<float>(a * std::exp(r1 * seconds) + b * std::exp(r2 * seconds)), static_cast<float>(a * r1 * std::exp(r1 * seconds) + b * r2 * std::exp(r2 * seconds))};
    }

    inline float sampleEasing(float fraction, const std::array<float, 4>& bezier) {
        if (fraction <= 0 || fraction >= 1) return std::clamp(fraction, 0.0f, 1.0f);
        const auto curve = [](float t, float a, float b) {
            return 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
        };
        float low = 0, high = 1;
        for (int i = 0; i < 24; ++i) {
            const auto mid = (low + high) / 2;
            if (curve(mid, bezier[0], bezier[2]) < fraction)
                low = mid;
            else
                high = mid;
        }
        return curve((low + high) / 2, bezier[1], bezier[3]);
    }

    struct SizeAnimation {
        bool initialized = false;
        bool running = false;
        Size current, from, target, velocity, initialVelocity;
        double startMillis = 0;
        AnimationSpec spec;

        Size update(Size next, const AnimationSpec& nextSpec, double now) {
            if (!initialized) {
                initialized = true;
                current = target = next;
                spec = nextSpec;
                return current;
            }
            if (target != next || spec != nextSpec) {
                from = current;
                target = next;
                initialVelocity = velocity;
                startMillis = now;
                spec = nextSpec;
                running = current != target || velocity != Size{};
            }
            if (!running) return current;
            const auto elapsed = std::max(0.0, now - startMillis);
            if (spec.kind == AnimationKind::Spring) {
                const auto w = sampleSpring(from.width - target.width, initialVelocity.width, elapsed / 1000, spec);
                const auto h = sampleSpring(from.height - target.height, initialVelocity.height, elapsed / 1000, spec);
                current = {std::max(0.0f, target.width + w.first), std::max(0.0f, target.height + h.first)};
                velocity = {w.second, h.second};
                running = std::abs(w.first) > spec.threshold || std::abs(h.first) > spec.threshold || std::abs(w.second) > spec.threshold * 10 || std::abs(h.second) > spec.threshold * 10;
            } else if (elapsed >= spec.delayMillis) {
                const auto fraction = spec.kind == AnimationKind::Snap || spec.durationMillis == 0 ? 1.0f : std::min(1.0f, static_cast<float>((elapsed - spec.delayMillis) / spec.durationMillis));
                const auto progress = sampleEasing(fraction, spec.bezier);
                current = {std::max(0.0f, from.width + (target.width - from.width) * progress), std::max(0.0f, from.height + (target.height - from.height) * progress)};
                velocity = {};
                running = fraction < 1;
            }
            if (!running) {
                current = target;
                velocity = {};
            }
            return current;
        }
    };
}  // namespace arrange::core
