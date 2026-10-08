#include "WindowsPrecisionWheelSource.h"

#if ARRANGE_JUCE_WITH_JUCE && JUCE_WINDOWS

#include <atomic>
#include <cmath>
#include <mutex>
#include <optional>
#include <utility>
#include <vector>
#include <windows.h>
#include <commctrl.h>
#include <directmanipulation.h>
#include <objbase.h>
#include <wrl.h>

namespace arrange::juce {
    namespace {
        using Microsoft::WRL::ComPtr;
        // PT_TOUCHPAD 的 SDK 值为 5，兼容旧 SDK 未提供该枚举名的情况
        constexpr auto touchpadPointerType = static_cast<POINTER_INPUT_TYPE>(5);

        struct PendingWheelInput {
            arrange::core::Point point;
            WheelInput input;
        };

        // 未测试！
        struct ManipulationState {
            std::mutex mutex;
            std::vector<PendingWheelInput> pending;
            std::atomic<HWND> window = nullptr;
            std::atomic<bool> ticks = false;
            std::atomic<bool> wakeQueued = false;
            UINT wakeMessage = RegisterWindowMessageW(L"Arrange.WindowsPrecisionWheelSource.Wake");
            arrange::core::Point point;
            float scale = 1.0f;
            float lastX = 0.0f;
            float lastY = 0.0f;
            RECT viewportRect{};
            bool active = false;
            bool inertial = false;
            bool resetting = false;
            DIRECTMANIPULATION_STATUS status = DIRECTMANIPULATION_ENABLED;

            void wake() {
                const auto target = window.load();
                if (target != nullptr && wakeMessage != 0 && !wakeQueued.exchange(true)) {
                    if (!PostMessageW(target, wakeMessage, 0, 0)) wakeQueued.store(false);
                }
            }

            void append(WheelInput input) {
                input.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
                input.precise = true;
                input.nativePhases = true;
                pending.push_back({point, input});
            }

            void finish(bool cancelled) {
                if (!active) return;
                WheelInput input;
                if (inertial) {
                    input.inertial = true;
                    input.momentumPhase = cancelled ? WheelPhase::Cancelled : WheelPhase::Ended;
                } else {
                    input.phase = cancelled ? WheelPhase::Cancelled : WheelPhase::Ended;
                }
                append(input);
                active = false;
                inertial = false;
            }

            void begin() {
                if (active && !inertial) return;
                finish(false);
                active = true;
                inertial = false;
                WheelInput input;
                input.phase = WheelPhase::Began;
                append(input);
            }
        };

        // 未测试！
        class ManipulationEventHandler final : public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>, Microsoft::WRL::FtmBase, IDirectManipulationViewportEventHandler, IDirectManipulationInteractionEventHandler> {
           public:
            explicit ManipulationEventHandler(std::shared_ptr<ManipulationState> state) : state_(std::move(state)) {}

            HRESULT STDMETHODCALLTYPE OnViewportStatusChanged(IDirectManipulationViewport* viewport, DIRECTMANIPULATION_STATUS current, DIRECTMANIPULATION_STATUS previous) override {
                const ComPtr<ManipulationEventHandler> keepAlive(this);
                if (current == previous) return S_OK;
                RECT resetRect{};
                bool reset = false;
                bool resetting = false;
                {
                    std::lock_guard lock(state_->mutex);
                    if (state_->window.load() == nullptr) return S_OK;
                    state_->status = current;
                    resetting = state_->resetting;
                    if (resetting) {
                        if (current == DIRECTMANIPULATION_READY) {
                            state_->resetting = false;
                            state_->ticks.store(false);
                        }
                    } else if (current == DIRECTMANIPULATION_RUNNING) {
                        state_->begin();
                        state_->ticks.store(true);
                    } else if (current == DIRECTMANIPULATION_INERTIA && state_->active && !state_->inertial) {
                        state_->inertial = true;
                        WheelInput input;
                        input.phase = WheelPhase::Ended;
                        input.momentumPhase = WheelPhase::Began;
                        input.inertial = true;
                        state_->append(input);
                    } else if (current == DIRECTMANIPULATION_READY) {
                        state_->finish(false);
                        reset = state_->lastX != 0.0f || state_->lastY != 0.0f;
                        state_->ticks.store(reset);
                        state_->lastX = 0.0f;
                        state_->lastY = 0.0f;
                        state_->resetting = reset;
                        resetRect = state_->viewportRect;
                    } else if (current == DIRECTMANIPULATION_DISABLED || current == DIRECTMANIPULATION_SUSPENDED) {
                        state_->finish(true);
                        state_->ticks.store(false);
                    }
                }
                // 虚拟内容只提供位移；回到单位变换时不向 Arrange 派发反向滚动
                if (!resetting && reset && viewport != nullptr) {
                    if (FAILED(viewport->ZoomToRect(static_cast<float>(resetRect.left), static_cast<float>(resetRect.top), static_cast<float>(resetRect.right), static_cast<float>(resetRect.bottom), FALSE))) {
                        std::lock_guard lock(state_->mutex);
                        state_->resetting = false;
                        state_->ticks.store(false);
                    }
                }
                state_->wake();
                return S_OK;
            }

            HRESULT STDMETHODCALLTYPE OnViewportUpdated(IDirectManipulationViewport*) override {
                return S_OK;
            }

            HRESULT STDMETHODCALLTYPE OnContentUpdated(IDirectManipulationViewport*, IDirectManipulationContent* content) override {
                const ComPtr<ManipulationEventHandler> keepAlive(this);
                if (content == nullptr) return E_INVALIDARG;
                float transform[6]{};
                const auto result = content->GetContentTransform(transform, 6);
                if (FAILED(result)) return result;
                if (!std::isfinite(transform[4]) || !std::isfinite(transform[5])) return S_OK;
                {
                    std::lock_guard lock(state_->mutex);
                    if (state_->window.load() == nullptr || state_->resetting || !state_->active) return S_OK;
                    WheelInput input;
                    input.deltaX = (transform[4] - state_->lastX) / state_->scale;
                    input.deltaY = (transform[5] - state_->lastY) / state_->scale;
                    state_->lastX = transform[4];
                    state_->lastY = transform[5];
                    if (input.deltaX == 0.0f && input.deltaY == 0.0f) return S_OK;
                    input.inertial = state_->inertial;
                    if (state_->inertial) input.momentumPhase = WheelPhase::Changed;
                    else input.phase = WheelPhase::Changed;
                    state_->append(input);
                }
                state_->wake();
                return S_OK;
            }

            HRESULT STDMETHODCALLTYPE OnInteraction(IDirectManipulationViewport2*, DIRECTMANIPULATION_INTERACTION_TYPE interaction) override {
                const ComPtr<ManipulationEventHandler> keepAlive(this);
                {
                    std::lock_guard lock(state_->mutex);
                    if (state_->window.load() == nullptr || state_->resetting) return S_OK;
                    if (interaction == DIRECTMANIPULATION_INTERACTION_BEGIN) {
                        state_->begin();
                        state_->ticks.store(true);
                    } else if (interaction == DIRECTMANIPULATION_INTERACTION_END) {
                        // 接触结束不抢先结束 RUNNING 或 INERTIA；viewport READY 才结束整次滚动
                        if (state_->status != DIRECTMANIPULATION_RUNNING && state_->status != DIRECTMANIPULATION_INERTIA) {
                            state_->finish(false);
                            state_->ticks.store(false);
                        }
                    }
                }
                state_->wake();
                return S_OK;
            }

           private:
            std::shared_ptr<ManipulationState> state_;
        };
    }

    // 未测试！
    struct WindowsPrecisionWheelSource::Impl {
        InputCallback onInput;
        WakeCallback onWake;
        ::juce::Component::SafePointer<::juce::Component> owner;
        std::shared_ptr<ManipulationState> state = std::make_shared<ManipulationState>();
        ComPtr<IDirectManipulationManager> manager;
        ComPtr<IDirectManipulationUpdateManager> updateManager;
        ComPtr<IDirectManipulationViewport> viewport;
        ComPtr<ManipulationEventHandler> handler;
        HWND window = nullptr;
        DWORD handlerCookie = 0;
        bool subscribed = false;
        bool initializedCom = false;
        arrange::core::Point dispatchedPoint;
        bool hasDispatchedPoint = false;

        Impl(InputCallback input, WakeCallback wake) : onInput(std::move(input)), onWake(std::move(wake)) {}

        ~Impl() {
            detach();
        }

        std::optional<arrange::core::Point> cursorPoint() const {
            if (owner == nullptr || window == nullptr) return std::nullopt;
            auto* peer = owner->getPeer();
            if (peer == nullptr) return std::nullopt;
            POINT cursor{};
            if (!GetCursorPos(&cursor) || !ScreenToClient(window, &cursor)) return std::nullopt;
            const auto scale = static_cast<float>(peer->getPlatformScaleFactor());
            if (!std::isfinite(scale) || scale <= 0.0f) return std::nullopt;
            const auto point = owner->getLocalPoint(&peer->getComponent(), ::juce::Point<float>{static_cast<float>(cursor.x) / scale, static_cast<float>(cursor.y) / scale});
            return arrange::core::Point{point.x, point.y};
        }

        void drain() {
            std::vector<PendingWheelInput> pending;
            {
                std::lock_guard lock(state->mutex);
                pending.swap(state->pending);
            }
            for (const auto& sample : pending) {
                if (sample.input.phase == WheelPhase::Began) {
                    // RUNNING 中的新接触可能由系统直接分配；每次真起手在 UI 线程重取初始点
                    dispatchedPoint = cursorPoint().value_or(sample.point);
                    hasDispatchedPoint = true;
                    std::lock_guard lock(state->mutex);
                    state->point = dispatchedPoint;
                }
                if (onInput) onInput(hasDispatchedPoint ? dispatchedPoint : sample.point, sample.input);
            }
        }

        void detach() {
            state->window.store(nullptr);
            {
                std::lock_guard lock(state->mutex);
                state->finish(true);
                state->ticks.store(false);
                state->lastX = 0.0f;
                state->lastY = 0.0f;
                state->resetting = false;
                state->status = DIRECTMANIPULATION_ENABLED;
            }
            if (window != nullptr && subscribed) RemoveWindowSubclass(window, windowProcedure, reinterpret_cast<UINT_PTR>(this));
            subscribed = false;
            if (viewport != nullptr) {
                viewport->Stop();
                if (handlerCookie != 0) viewport->RemoveEventHandler(handlerCookie);
                viewport->Abandon();
            }
            if (manager != nullptr && window != nullptr) manager->Deactivate(window);
            handlerCookie = 0;
            handler.Reset();
            viewport.Reset();
            updateManager.Reset();
            manager.Reset();
            if (initializedCom) CoUninitialize();
            initializedCom = false;
            window = nullptr;
            owner = nullptr;
            state->wakeQueued.store(false);
            drain();
            hasDispatchedPoint = false;
        }

        void sync(::juce::Component& component) {
            if (!component.isShowing()) {
                detach();
                return;
            }
            auto* peer = component.getPeer();
            const auto newWindow = peer != nullptr ? static_cast<HWND>(peer->getNativeHandle()) : nullptr;
            if (newWindow == window && viewport != nullptr) {
                owner = &component;
                if (!updateViewportRect()) detach();
                return;
            }
            detach();
            if (newWindow == nullptr || state->wakeMessage == 0 || !IsWindow(newWindow) || GetWindowThreadProcessId(newWindow, nullptr) != GetCurrentThreadId()) return;
            window = newWindow;
            owner = &component;
            state->window.store(window);
            const auto comResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
            initializedCom = SUCCEEDED(comResult);
            if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
                detach();
                return;
            }
            if (FAILED(CoCreateInstance(CLSID_DirectManipulationManager, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(manager.GetAddressOf()))) || FAILED(manager->GetUpdateManager(IID_PPV_ARGS(updateManager.GetAddressOf()))) || FAILED(manager->CreateViewport(nullptr, window, IID_PPV_ARGS(viewport.GetAddressOf())))) {
                detach();
                return;
            }
            const auto configuration = static_cast<DIRECTMANIPULATION_CONFIGURATION>(DIRECTMANIPULATION_CONFIGURATION_INTERACTION | DIRECTMANIPULATION_CONFIGURATION_TRANSLATION_X | DIRECTMANIPULATION_CONFIGURATION_TRANSLATION_Y | DIRECTMANIPULATION_CONFIGURATION_TRANSLATION_INERTIA | DIRECTMANIPULATION_CONFIGURATION_RAILS_X | DIRECTMANIPULATION_CONFIGURATION_RAILS_Y);
            handler = Microsoft::WRL::Make<ManipulationEventHandler>(state);
            if (FAILED(viewport->ActivateConfiguration(configuration)) || FAILED(viewport->SetViewportOptions(DIRECTMANIPULATION_VIEWPORT_OPTIONS_MANUALUPDATE)) || FAILED(viewport->AddEventHandler(window, handler.Get(), &handlerCookie))) {
                detach();
                return;
            }
            if (!updateViewportRect() || FAILED(manager->Activate(window)) || FAILED(viewport->Enable()) || !SetWindowSubclass(window, windowProcedure, reinterpret_cast<UINT_PTR>(this), reinterpret_cast<DWORD_PTR>(this))) {
                detach();
                return;
            }
            subscribed = true;
            updateManager->Update(nullptr);
            drain();
        }

        bool updateViewportRect() {
            if (owner == nullptr || viewport == nullptr) return false;
            auto* peer = owner->getPeer();
            if (peer == nullptr) return false;
            const auto scale = static_cast<float>(peer->getPlatformScaleFactor());
            const auto bounds = peer->getComponent().getLocalArea(owner.getComponent(), owner->getLocalBounds()).toFloat() * scale;
            const auto rect = bounds.getSmallestIntegerContainer();
            const RECT nativeRect{rect.getX(), rect.getY(), rect.getRight(), rect.getBottom()};
            bool changed;
            {
                std::lock_guard lock(state->mutex);
                // 同一真实手势中冻结 viewport 和 DPI，READY 后才采用新的组件尺寸
                if (state->active || state->resetting) return true;
                changed = !EqualRect(&state->viewportRect, &nativeRect);
                state->viewportRect = nativeRect;
                state->scale = scale > 0.0f ? scale : 1.0f;
            }
            if (!changed) return true;
            return SUCCEEDED(viewport->SetViewportRect(&nativeRect));
        }

        bool hitTest(WPARAM parameter) {
            if (owner == nullptr || viewport == nullptr) return false;
            const auto pointerId = GET_POINTERID_WPARAM(parameter);
            POINTER_INPUT_TYPE type = PT_POINTER;
            if (!GetPointerType(pointerId, &type) || type != touchpadPointerType) return false;
            const auto point = cursorPoint();
            if (!point || !owner->getLocalBounds().toFloat().contains(::juce::Point<float>{point->x, point->y})) return false;
            {
                std::lock_guard lock(state->mutex);
                if (!state->active || state->inertial) state->point = *point;
            }
            // 仅接管真实触控板；鼠标和触屏仍由原有 JUCE 输入链路处理
            if (FAILED(viewport->SetContact(pointerId))) return false;
            state->ticks.store(true);
            updateManager->Update(nullptr);
            drain();
            if (onWake) onWake();
            return true;
        }

        void tick() {
            if (updateManager == nullptr) return;
            if (state->ticks.load()) {
                if (FAILED(updateManager->Update(nullptr))) {
                    detach();
                    if (onWake) onWake();
                    return;
                }
                drain();
            }
            if (!updateViewportRect()) {
                detach();
                if (onWake) onWake();
            }
        }

        static LRESULT CALLBACK windowProcedure(HWND target, UINT message, WPARAM parameter, LPARAM data, UINT_PTR identity, DWORD_PTR reference) {
            auto& self = *reinterpret_cast<Impl*>(reference);
            if (message == self.state->wakeMessage) {
                self.state->wakeQueued.store(false);
                self.drain();
                if (!self.updateViewportRect()) self.detach();
                if (self.onWake) self.onWake();
                return 0;
            }
            if (message == DM_POINTERHITTEST && self.hitTest(parameter)) return 0;
            if (message == WM_NCDESTROY) {
                self.state->window.store(nullptr);
                {
                    std::lock_guard lock(self.state->mutex);
                    self.state->finish(true);
                    self.state->ticks.store(false);
                }
                RemoveWindowSubclass(target, windowProcedure, identity);
                self.subscribed = false;
                self.window = nullptr;
                self.owner = nullptr;
                self.drain();
            }
            return DefSubclassProc(target, message, parameter, data);
        }
    };

    WindowsPrecisionWheelSource::WindowsPrecisionWheelSource(InputCallback onInput, WakeCallback onWake) : impl_(std::make_unique<Impl>(std::move(onInput), std::move(onWake))) {}
    WindowsPrecisionWheelSource::~WindowsPrecisionWheelSource() = default;
    void WindowsPrecisionWheelSource::sync(::juce::Component& owner) { impl_->sync(owner); }
    void WindowsPrecisionWheelSource::tick() { impl_->tick(); }
    bool WindowsPrecisionWheelSource::needsTicks() const noexcept { return impl_->state->ticks.load(); }
    void WindowsPrecisionWheelSource::cancel() { impl_->detach(); }
}

#endif
