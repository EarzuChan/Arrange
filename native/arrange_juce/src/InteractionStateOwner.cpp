#include <arrange/juce/InteractionStateOwner.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/JucePointerInputAdapter.h>

#include <string>
#include <utility>

namespace arrange::juce {
    namespace {
        // 逻辑键名沿用 Web KeyboardEvent.key 的写法
        std::string keyName(const ::juce::KeyPress& key) {
            using K = ::juce::KeyPress;
            const auto code = key.getKeyCode();
            const std::pair<int, const char*> named[]{{K::returnKey, "Enter"}, {K::escapeKey, "Escape"}, {K::tabKey, "Tab"}, {K::backspaceKey, "Backspace"}, {K::deleteKey, "Delete"}, {K::insertKey, "Insert"}, {K::spaceKey, " "}, {K::upKey, "ArrowUp"}, {K::downKey, "ArrowDown"}, {K::leftKey, "ArrowLeft"}, {K::rightKey, "ArrowRight"}, {K::pageUpKey, "PageUp"}, {K::pageDownKey, "PageDown"}, {K::homeKey, "Home"}, {K::endKey, "End"}};
            for (const auto& [value, name] : named)
                if (code == value) return name;
            for (int index = 0; index < 12; ++index)
                if (code == K::F1Key + index) return "F" + std::to_string(index + 1);
            if (const auto character = key.getTextCharacter(); character >= 32 && character != 127) return ::juce::String::charToString(character).toStdString();
            return ::juce::String::charToString(static_cast<::juce::juce_wchar>(code)).toLowerCase().toStdString();
        }

        std::string keyText(const ::juce::KeyPress& key) {
            const auto character = key.getTextCharacter();
            return character >= 32 && character != 127 ? ::juce::String::charToString(character).toStdString() : std::string{};
        }

        arrange::core::PointerSample sampleAt(float x, float y, arrange::core::KeyModifierState modifiers) {
            return {{x, y}, modifiers, ::juce::Time::getMillisecondCounterHiRes()};
        }
    }

    arrange::core::KeyInput keyInput(const ::juce::KeyPress& key) {
        return {key.getKeyCode(), keyName(key), keyText(key), keyModifierState(key.getModifiers())};
    }

    InteractionStateOwner::InteractionStateOwner(arrange::core::TextLayoutService& textLayoutService) noexcept : input_(textLayoutService) {}

    void InteractionStateOwner::reset() {
        input_.reset();
        session_.reset();
    }

    arrange::core::PointerGestureOutput InteractionStateOwner::pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, const arrange::core::InputCallbacks& callbacks, arrange::core::PointerDownOptions options, arrange::core::KeyModifierState modifiers) {
        return session_.pointerDown(tree, snapshot, sampleAt(x, y, modifiers), input_, callbacks, options);
    }

    bool InteractionStateOwner::pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const arrange::core::InputCallbacks& callbacks, arrange::core::PointerGestureOutput* gesture, arrange::core::KeyModifierState modifiers) {
        return session_.pointerDrag(tree, runtimeReady, sampleAt(x, y, modifiers), input_, callbacks, gesture);
    }

    arrange::core::PointerUpResult InteractionStateOwner::pointerUp(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, arrange::core::KeyModifierState modifiers) {
        return session_.pointerUp(tree, snapshot, sampleAt(x, y, modifiers), input_);
    }

    arrange::core::PointerGestureOutput InteractionStateOwner::pointerMove(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y) {
        return session_.pointerMove(tree, snapshot, sampleAt(x, y, {}));
    }

    arrange::core::PointerGestureOutput InteractionStateOwner::contextClick(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, arrange::core::KeyModifierState modifiers) {
        return session_.contextClick(tree, snapshot, sampleAt(x, y, modifiers));
    }
}

#endif
