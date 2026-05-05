#pragma once

#include "App.h"
#include "AppResolver.h"
#include "ErrorScreenModel.h"
#include <arrange/quickjs/ScriptHost.h>

namespace arrange {
    enum class HeadlessEditorState {
        Empty,
        Loaded,
        Error,
    };

    class HeadlessArrangeEditor {
    public:
        HeadlessArrangeEditor(App app, quickjs::ScriptHost& scriptHost)
            : app_(std::move(app)), scriptHost_(scriptHost) {}

        HeadlessEditorState state() const noexcept { return state_; }
        const ResolvedApp& resolvedApp() const noexcept { return resolved_; }
        const ErrorScreenModel& error() const noexcept { return error_; }

        bool loadRelease();
        bool retryRelease() { return loadRelease(); }

    private:
        App app_;
        quickjs::ScriptHost& scriptHost_;
        AppResolver resolver_;
        HeadlessEditorState state_ = HeadlessEditorState::Empty;
        ResolvedApp resolved_;
        ErrorScreenModel error_;
    };
} // namespace arrange
