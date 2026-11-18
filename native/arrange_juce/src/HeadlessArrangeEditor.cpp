#include <arrange/juce/HeadlessArrangeEditor.h>

namespace arrange {
    bool HeadlessArrangeEditor::loadRelease() {
        resolved_ = resolver_.resolveRelease(app_);
        if (!resolved_.ok) {
            error_ = makeErrorScreenModel(ErrorSource::AppPackage, resolved_.error, {}, resolved_.packageDir);
            state_ = HeadlessEditorState::Error;
            return false;
        }

        const auto loaded = scriptHost_.executePackage(resolved_.package);
        if (!loaded.ok) {
            error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, loaded.error, {}, resolved_.packageDir);
            state_ = HeadlessEditorState::Error;
            return false;
        }

        error_ = {};
        state_ = HeadlessEditorState::Loaded;
        return true;
    }
}
