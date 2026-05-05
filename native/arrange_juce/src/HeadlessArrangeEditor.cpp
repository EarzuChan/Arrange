#include <arrange/juce/HeadlessArrangeEditor.h>
#include <arrange/quickjs/AppScriptLoader.h>

namespace arrange {
    bool HeadlessArrangeEditor::loadRelease() {
        resolved_ = resolver_.resolveRelease(app_);
        if (!resolved_.ok) {
            error_ = makeErrorScreenModel(ErrorSource::AppPackage, resolved_.error, {}, resolved_.entryPath);
            state_ = HeadlessEditorState::Error;
            return false;
        }

        quickjs::AppScriptLoader loader(scriptHost_);
        const auto loaded = loader.loadEntry(resolved_.entryPath);
        if (!loaded.ok) {
            error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, loaded.error, {}, loaded.modulePath);
            state_ = HeadlessEditorState::Error;
            return false;
        }

        error_ = {};
        state_ = HeadlessEditorState::Loaded;
        return true;
    }
} // namespace arrange
