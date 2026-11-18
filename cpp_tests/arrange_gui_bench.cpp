// 真实窗口性能夹具：借用完整 Demo UI，输入经过 Win32、JUCE 与 Arrange 正常链路，不进入 CTest
#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/Interop.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_graphics/juce_graphics.h>

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
    struct Options {
        std::filesystem::path fixture;
        std::filesystem::path output;
        std::string scenario = "mixed";
        std::string expectedD2D;
        double seconds = 10;
        double timeoutSeconds = 90;
        int width = 900;
        int height = 780;
        int wheelDelta = 360;
        int wheelInterval = 40;
        int toggleInterval = 160;
    };

    Options parseOptions() {
        Options options;
        const auto arguments = ::juce::JUCEApplication::getCommandLineParameterArray();
        for (int index = 0; index < arguments.size(); ++index) {
            const auto key = arguments[index];
            if (++index >= arguments.size()) throw std::runtime_error("选项缺少参数：" + key.toStdString());
            const auto value = arguments[index];
            if (key == "--fixture") options.fixture = value.toWideCharPointer();
            else if (key == "--out") options.output = value.toWideCharPointer();
            else if (key == "--scenario") options.scenario = value.toStdString();
            else if (key == "--duration") options.seconds = value.getDoubleValue();
            else if (key == "--timeout") options.timeoutSeconds = value.getDoubleValue();
            else if (key == "--width") options.width = value.getIntValue();
            else if (key == "--height") options.height = value.getIntValue();
            else if (key == "--wheel-delta") options.wheelDelta = value.getIntValue();
            else if (key == "--wheel-interval") options.wheelInterval = value.getIntValue();
            else if (key == "--toggle-interval") options.toggleInterval = value.getIntValue();
            else if (key == "--expect-d2d") options.expectedD2D = value.toStdString();
            else throw std::runtime_error("未知选项：" + key.toStdString());
        }
        if (options.fixture.empty() || options.output.empty()) throw std::runtime_error("需要 --fixture <gallery目录> --out <输出目录>，可选 --scenario home|animation|mixed --duration 秒 --timeout 秒");
        if (!std::filesystem::exists(options.fixture / "app.js")) throw std::runtime_error("gallery 夹具缺少 app.js");
        if (options.scenario != "home" && options.scenario != "animation" && options.scenario != "mixed") throw std::runtime_error("scenario 只能是 home、animation 或 mixed");
        if (options.seconds < 1 || options.seconds > 600 || options.timeoutSeconds < options.seconds || options.timeoutSeconds > 1800 || options.width < 420 || options.height < 300 || options.wheelInterval < 10 || options.toggleInterval < 40 || options.wheelDelta < 1) throw std::runtime_error("测试参数越界");
        options.fixture = std::filesystem::absolute(options.fixture);
        options.output = std::filesystem::absolute(options.output);
        return options;
    }

    class Processor final : public ::juce::AudioProcessor {
       public:
        const ::juce::String getName() const override { return "Arrange GUI Bench"; }
        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(::juce::AudioBuffer<float>&, ::juce::MidiBuffer&) override {}
        double getTailLengthSeconds() const override { return 0; }
        bool acceptsMidi() const override { return false; }
        bool producesMidi() const override { return false; }
        ::juce::AudioProcessorEditor* createEditor() override { return nullptr; }
        bool hasEditor() const override { return false; }
        int getNumPrograms() override { return 1; }
        int getCurrentProgram() override { return 0; }
        void setCurrentProgram(int) override {}
        const ::juce::String getProgramName(int) override { return {}; }
        void changeProgramName(int, const ::juce::String&) override {}
        void getStateInformation(::juce::MemoryBlock&) override {}
        void setStateInformation(const void*, int) override {}
    };

    class Window final : public ::juce::DocumentWindow {
       public:
        Window() : DocumentWindow("Arrange 真实窗口基准", ::juce::Colours::black, DocumentWindow::closeButton) {
            setUsingNativeTitleBar(true);
        }
        void closeButtonPressed() override { ::juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
    };

    struct CapturedFrame {
        std::string phase;
        arrange::core::FrameRecord record;
    };

    struct InputRecord {
        double time = 0;
        std::string phase;
        std::string action;
        int x = 0;
        int y = 0;
        int delta = 0;
    };

    // 屏幕捕获不调用 Component::createComponentSnapshot，避免用一次离屏重画冒充窗口实际画面
    void captureWindow(HWND hwnd, const std::filesystem::path& path) {
        RECT client{};
        if (!GetClientRect(hwnd, &client)) throw std::runtime_error("无法读取窗口客户区");
        POINT origin{0, 0};
        if (!ClientToScreen(hwnd, &origin)) throw std::runtime_error("无法转换窗口屏幕坐标");
        const int width = client.right, height = client.bottom;
        const auto screen = GetDC(nullptr);
        const auto target = CreateCompatibleDC(screen);
        BITMAPINFO info{};
        info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        void* pixels = nullptr;
        const auto bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
        if (!screen || !target || !bitmap || !pixels) {
            if (bitmap) DeleteObject(bitmap);
            if (target) DeleteDC(target);
            if (screen) ReleaseDC(nullptr, screen);
            throw std::runtime_error("无法创建窗口截图缓冲");
        }
        const auto previous = SelectObject(target, bitmap);
        const auto ok = BitBlt(target, 0, 0, width, height, screen, origin.x, origin.y, SRCCOPY | CAPTUREBLT);
        ::juce::Image image(::juce::Image::RGB, width, height, false, ::juce::SoftwareImageType());
        if (ok) {
            ::juce::Image::BitmapData data(image, ::juce::Image::BitmapData::writeOnly);
            const auto* bytes = static_cast<const unsigned char*>(pixels);
            for (int y = 0; y < height; ++y)
                for (int x = 0; x < width; ++x) {
                    const auto* pixel = bytes + (static_cast<std::size_t>(y) * width + x) * 4;
                    data.setPixelColour(x, y, ::juce::Colour(pixel[2], pixel[1], pixel[0]));
                }
        }
        SelectObject(target, previous);
        DeleteObject(bitmap);
        DeleteDC(target);
        ReleaseDC(nullptr, screen);
        if (!ok) throw std::runtime_error("窗口屏幕捕获失败");
        ::juce::FileOutputStream output(::juce::File(::juce::String(path.wstring().c_str())));
        if (!output.openedOk() || !::juce::PNGImageFormat{}.writeImageToStream(image, output)) throw std::runtime_error("窗口截图写入失败");
    }

    class Application final : public ::juce::JUCEApplication, private ::juce::Timer {
       public:
        const ::juce::String getApplicationName() override { return "Arrange GUI Bench"; }
        const ::juce::String getApplicationVersion() override { return "1"; }
        bool moreThanOneInstanceAllowed() override { return true; }

        void initialise(const ::juce::String&) override {
            try {
                options_ = parseOptions();
                if (::juce::SystemStats::getEnvironmentVariable("ARRANGE_RENDER_METRICS", "") != "1") throw std::runtime_error("真实窗口基准需要 ARRANGE_RENDER_METRICS=1 才能采集重放指标");
                watchdogStop_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
                if (!watchdogStop_) throw std::runtime_error("无法建立超时监视器");
                watchdog_ = std::thread([this] {
                    const auto result = WaitForSingleObject(watchdogStop_, static_cast<DWORD>(options_.timeoutSeconds * 1000.0));
                    if (result == WAIT_TIMEOUT) {
                        std::cerr << "真实窗口基准硬超时，终止自身进程（无法保证消息线程仍能写盘）\n";
                        TerminateProcess(GetCurrentProcess(), 3);
                    }
                });
                std::filesystem::create_directories(options_.output);
                frames_.clear();
                inputs_.reserve(10000);
                processor_ = std::make_unique<Processor>();
                // 互操作端点使首页主题数量与正式 Demo 一致，不启动音频设备，不测试音频页
                interop_ = std::make_unique<arrange::juce::Interop>(*processor_);
                arrange::juce::EditorConfig config;
                config.app.useDist(options_.fixture);
                config.width = options_.width;
                config.height = options_.height;
                config.window.title = "Arrange 真实窗口基准";
                config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Hidden;
                config.diagnostics.toasts = arrange::juce::DiagnosticVisibility::Hidden;
                config.diagnostics.overlay = arrange::juce::DiagnosticVisibility::Hidden;
                config.interop = interop_.get();
                editor_ = std::make_unique<arrange::juce::ArrangeEditor>(*processor_, config);
                editor_->setFrameTimelineEnabled(true);
                window_ = std::make_unique<Window>();
                window_->setContentNonOwned(editor_.get(), true);
                window_->centreWithSize(options_.width, options_.height);
                window_->setVisible(true);
                window_->toFront(true);
                auto* peer = window_->getPeer();
                if (!peer) throw std::runtime_error("真实窗口未建立 peer");
                const auto engines = peer->getAvailableRenderingEngines();
                for (int index = 0; index < engines.size(); ++index)
                    if (engines[index].containsIgnoreCase("Direct2D")) engine_ = index;
                if (engine_ < 0) throw std::runtime_error("窗口没有 Direct2D 渲染引擎");
                peer->setCurrentRenderingEngine(engine_);
                if (peer->getCurrentRenderingEngine() != engine_) throw std::runtime_error("Direct2D 引擎选择失败");
                engineName_ = engines[engine_].toStdString();
                hwnd_ = static_cast<HWND>(peer->getNativeHandle());
                SetForegroundWindow(hwnd_);
                started_ = now();
                stageStart_ = started_;
                startTimer(10);
                std::cout << "真实窗口已建立，PID=" << GetCurrentProcessId() << "，引擎=" << engineName_ << "；测试期间请勿操作鼠标或覆盖窗口\n";
            } catch (const std::exception& error) {
                fail(error.what());
            }
        }

        void shutdown() override {
            stopTimer();
            stopMeasuredInputs(true);
            if (watchdogStop_) SetEvent(watchdogStop_);
            if (watchdog_.joinable()) watchdog_.join();
            if (watchdogStop_) CloseHandle(watchdogStop_);
            watchdogStop_ = nullptr;
            window_.reset();
            editor_.reset();
            interop_.reset();
            processor_.reset();
        }

        void systemRequestedQuit() override { fail("用户关闭测试窗口，测试未完成"); }

       private:
        static double now() { return ::juce::Time::getMillisecondCounterHiRes(); }
        enum class Stage { Ready, Home, DrainHome, FindAnimation, WaitAnimation, FindToggle, Animation, DrainAnimation, Done };

        std::string phase() const {
            if (stage_ == Stage::Home) return "home";
            if (stage_ == Stage::Animation) return "animation";
            if (stage_ == Stage::DrainHome) return "home-settle";
            if (stage_ == Stage::DrainAnimation) return "animation-settle";
            return "setup";
        }

        void setStage(Stage next) {
            stage_ = next;
            stageStart_ = now();
            nextInput_ = stageStart_;
            inputs_.push_back({stageStart_, phase(), "phase-start", 0, 0, 0});
            if (next == Stage::Home || next == Stage::Animation) startMeasuredInputs(next == Stage::Animation);
        }

        void collect() {
            if (!editor_) return;
            const auto& timeline = editor_->frameTimeline();
            for (std::size_t index = 0; index < timeline.size(); ++index) {
                const auto& record = timeline.at(index);
                // 只有最新修订仍可能在 paint 后补写累计值，旧记录不再反复复制
                if (record.sequence < lastCapturedSequence_) continue;
                const auto found = frames_.find(record.sequence);
                if (found != frames_.end()) found->second.record = record;
                else frames_.emplace(record.sequence, CapturedFrame{phase(), record});
            }
            if (const auto* latest = timeline.latest()) lastCapturedSequence_ = latest->sequence;
        }

        void ensureForeground() const {
            if (GetAncestor(GetForegroundWindow(), GA_ROOT) != GetAncestor(hwnd_, GA_ROOT)) throw std::runtime_error("测试窗口失去前台，停止输入以免操作其它程序");
        }

        ::juce::Point<int> movePointer(::juce::Point<float> local) {
            ensureForeground();
            // JUCE 桌面坐标在多 DPI 屏幕上不是 Win32 的物理屏幕坐标，先映射到窗口客户区再换成物理像素
            const auto inWindow = window_->getLocalPoint(editor_.get(), local);
            const auto scale = window_->getPeer()->getPlatformScaleFactor();
            POINT physical{static_cast<LONG>(std::lround(inWindow.x * scale)), static_cast<LONG>(std::lround(inWindow.y * scale))};
            if (!ClientToScreen(hwnd_, &physical)) throw std::runtime_error("无法转换输入坐标");
            const ::juce::Point<int> screen(physical.x, physical.y);
            const auto left = GetSystemMetrics(SM_XVIRTUALSCREEN), top = GetSystemMetrics(SM_YVIRTUALSCREEN);
            const auto width = GetSystemMetrics(SM_CXVIRTUALSCREEN), height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            INPUT input{};
            input.type = INPUT_MOUSE;
            input.mi.dx = static_cast<LONG>(std::llround(static_cast<double>(screen.x - left) * 65535.0 / std::max(1, width - 1)));
            input.mi.dy = static_cast<LONG>(std::llround(static_cast<double>(screen.y - top) * 65535.0 / std::max(1, height - 1)));
            input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
            if (SendInput(1, &input, sizeof(INPUT)) != 1) throw std::runtime_error("SendInput 移动鼠标失败");
            return screen;
        }

        void wheel(int delta) {
            const auto point = movePointer({options_.width * 0.3f, options_.height * 0.55f});
            INPUT input{};
            input.type = INPUT_MOUSE;
            input.mi.mouseData = static_cast<DWORD>(delta);
            input.mi.dwFlags = MOUSEEVENTF_WHEEL;
            if (SendInput(1, &input, sizeof(INPUT)) != 1) throw std::runtime_error("SendInput 滚轮失败");
            inputs_.push_back({now(), phase(), "wheel", point.x, point.y, delta});
        }

        void click(::juce::Point<float> local, const char* label) {
            const auto point = movePointer(local);
            INPUT inputs[2]{};
            inputs[0].type = inputs[1].type = INPUT_MOUSE;
            inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
            inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
            if (SendInput(2, inputs, sizeof(INPUT)) != 2) throw std::runtime_error("SendInput 点击失败");
            inputs_.push_back({now(), phase(), label, point.x, point.y, 0});
            if (stage_ != Stage::Animation) std::cout << "点击 " << label << "，编辑器坐标=" << local.toString().toStdString() << "，屏幕坐标=" << point.toString().toStdString() << '\n';
        }

        static double processCpuMillis() {
            FILETIME created{}, exited{}, kernel{}, user{};
            if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user)) throw std::runtime_error("无法读取进程 CPU 时间");
            const auto value = [](FILETIME time) { return (static_cast<std::uint64_t>(time.dwHighDateTime) << 32) | time.dwLowDateTime; };
            return static_cast<double>(value(kernel) + value(user)) / 10000.0;
        }

        // 测量输入由独立线程按固定时刻发送，UI 卡顿不能改变负载数量；不从工作线程访问 JUCE 对象
        void startMeasuredInputs(bool animation) {
            if (inputThread_.joinable()) throw std::runtime_error("上一段输入尚未结束");
            const auto screen = movePointer(animation ? toggle_ : ::juce::Point<float>(options_.width * 0.3f, options_.height * 0.55f));
            inputStop_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            if (!inputStop_) throw std::runtime_error("无法建立输入线程取消信号");
            workerInputs_.clear();
            workerError_.clear();
            const auto interval = animation ? options_.toggleInterval : options_.wheelInterval;
            const auto count = static_cast<int>(std::ceil(options_.seconds * 1000.0 / interval));
            const auto delta = options_.wheelDelta;
            const auto hwnd = hwnd_;
            const auto stop = inputStop_;
            const auto label = animation ? std::string("animation") : std::string("home");
            processCpuStart_ = processCpuMillis();
            measuredPhase_ = label;
            inputThread_ = std::thread([this, animation, interval, count, delta, screen, hwnd, stop, label] {
                using Clock = std::chrono::steady_clock;
                const auto epoch = Clock::now() + std::chrono::milliseconds(20);
                const auto timestamp = [] { LARGE_INTEGER value{}, frequency{}; QueryPerformanceCounter(&value); QueryPerformanceFrequency(&frequency); return static_cast<double>(value.QuadPart) * 1000.0 / static_cast<double>(frequency.QuadPart); };
                std::vector<InputRecord> captured;
                captured.reserve(static_cast<std::size_t>(count));
                for (int index = 0; index < count; ++index) {
                    const auto deadline = epoch + std::chrono::milliseconds(static_cast<std::int64_t>(index) * interval);
                    while (Clock::now() < deadline) {
                        const auto remaining = std::chrono::duration<double, std::milli>(deadline - Clock::now()).count();
                        if (WaitForSingleObject(stop, static_cast<DWORD>(std::max(1.0, std::ceil(remaining)))) == WAIT_OBJECT_0) {
                            workerInputs_ = std::move(captured);
                            return;
                        }
                    }
                    if (WaitForSingleObject(stop, 0) == WAIT_OBJECT_0) break;
                    if (GetAncestor(GetForegroundWindow(), GA_ROOT) != GetAncestor(hwnd, GA_ROOT)) {
                        workerError_ = "测量输入线程发现窗口失去前台，停止输入";
                        break;
                    }
                    POINT actual{};
                    if (!GetCursorPos(&actual) || std::abs(actual.x - screen.x) > 1 || std::abs(actual.y - screen.y) > 1) {
                        workerError_ = "测量期间鼠标位置变化，期望 " + std::to_string(screen.x) + "," + std::to_string(screen.y) + "，实际 " + std::to_string(actual.x) + "," + std::to_string(actual.y) + "，停止输入";
                        break;
                    }
                    const auto wheel = ((index * interval / 700) % 2 ? 1 : -1) * delta;
                    INPUT events[2]{};
                    events[0].type = events[1].type = INPUT_MOUSE;
                    events[0].mi.dwFlags = animation ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_WHEEL;
                    events[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
                    events[0].mi.mouseData = animation ? 0 : static_cast<DWORD>(wheel);
                    const UINT needed = animation ? 2 : 1;
                    if (SendInput(needed, events, sizeof(INPUT)) != needed) {
                        workerError_ = "测量输入线程 SendInput 失败";
                        break;
                    }
                    captured.push_back({timestamp(), label, animation ? "toggle-animation" : "wheel", screen.x, screen.y, animation ? 0 : wheel});
                }
                workerInputs_ = std::move(captured);
            });
        }

        void stopMeasuredInputs(bool cancel) {
            if (!inputThread_.joinable()) return;
            if (cancel) SetEvent(inputStop_);
            inputThread_.join();
            CloseHandle(inputStop_);
            inputStop_ = nullptr;
            inputs_.insert(inputs_.end(), workerInputs_.begin(), workerInputs_.end());
            processCpu_[measuredPhase_] = processCpuMillis() - processCpuStart_;
            const auto expected = static_cast<std::size_t>(std::ceil(options_.seconds * 1000.0 / (measuredPhase_ == "animation" ? options_.toggleInterval : options_.wheelInterval)));
            if (!cancel && (!workerError_.empty() || workerInputs_.size() != expected)) throw std::runtime_error(workerError_.empty() ? "实际输入次数不等于固定计划次数" : workerError_);
        }

        void validateD2D() {
            const auto module = GetModuleHandleW(L"d2d1.dll");
            if (!module) throw std::runtime_error("窗口首帧后仍未加载 d2d1.dll");
            std::vector<wchar_t> path(32768);
            const auto length = GetModuleFileNameW(module, path.data(), static_cast<DWORD>(path.size()));
            if (length == 0 || length == path.size()) throw std::runtime_error("无法取得实际 D2D1 模块路径");
            d2dPath_ = ::juce::String(path.data()).toStdString();
            if (!options_.expectedD2D.empty() && !::juce::String(d2dPath_).replaceCharacter('\\', '/').equalsIgnoreCase(::juce::String(options_.expectedD2D).replaceCharacter('\\', '/'))) throw std::runtime_error("实际 D2D1 模块路径与 --expect-d2d 不同：" + d2dPath_);
            std::cout << "实际 D2D1=" << d2dPath_ << '\n';
        }

        void timerCallback() override {
            try {
                collect();
                const auto time = now();
                if (time - started_ > options_.timeoutSeconds * 1000.0) throw std::runtime_error("测试总超时");
                if (stage_ != Stage::Ready) ensureForeground();
                switch (stage_) {
                    case Stage::Ready: {
                        const auto* latest = editor_->frameTimeline().latest();
                        if (!latest || latest->failed || latest->millis.paint <= 0) {
                            if (time - stageStart_ > 15000) throw std::runtime_error("15 秒内未建立成功发布并绘制的首帧");
                            break;
                        }
                        if (time - stageStart_ < 1800) break;
                        validateD2D();
                        ensureForeground();
                        captureWindow(hwnd_, options_.output / "home.png");
                        if (options_.scenario == "animation") setStage(Stage::FindAnimation);
                        else setStage(Stage::Home);
                        break;
                    }
                    case Stage::Home:
                        if (time - stageStart_ >= options_.seconds * 1000.0 + 40) {
                            stopMeasuredInputs(false);
                            setStage(Stage::DrainHome);
                        }
                        break;
                    case Stage::DrainHome:
                        if (time - stageStart_ < 600) break;
                        captureWindow(hwnd_, options_.output / "home-after.png");
                        if (options_.scenario == "home") finish();
                        else setStage(Stage::FindAnimation);
                        break;
                    case Stage::FindAnimation:
                        if (time - stageStart_ > 10000) throw std::runtime_error("滚动搜索后仍未找到可点击的动画卡");
                        if (time < nextInput_) break;
                        if (const auto target = editor_->diagnosticClickPoint("动画")) {
                            captureWindow(hwnd_, options_.output / "animation-card.png");
                            click(*target, "open-animation");
                            setStage(Stage::WaitAnimation);
                        } else {
                            // 先扫回顶部再向下搜索，避免首页猛滚恰好停在动画卡下方
                            const auto direction = static_cast<int>((time - stageStart_) / 1800.0) % 2 ? -1 : 1;
                            wheel(direction * 360);
                            nextInput_ = time + 200;
                        }
                        break;
                    case Stage::WaitAnimation:
                        if (time - stageStart_ >= 700) setStage(Stage::FindToggle);
                        break;
                    case Stage::FindToggle:
                        if (time - stageStart_ > 10000) throw std::runtime_error("动画页没有找到全部播放按钮");
                        if (time < nextInput_) break;
                        if (const auto target = editor_->diagnosticClickPoint("全部播放")) {
                            toggle_ = *target;
                            captureWindow(hwnd_, options_.output / "animation.png");
                            setStage(Stage::Animation);
                        } else {
                            wheel(-120);
                            nextInput_ = time + 250;
                        }
                        break;
                    case Stage::Animation:
                        if (time - stageStart_ >= options_.seconds * 1000.0 + 40) {
                            stopMeasuredInputs(false);
                            setStage(Stage::DrainAnimation);
                        }
                        break;
                    case Stage::DrainAnimation:
                        if (time - stageStart_ >= 1000) {
                            captureWindow(hwnd_, options_.output / "animation-after.png");
                            finish();
                        }
                        break;
                    case Stage::Done:
                        break;
                }
            } catch (const std::exception& error) {
                fail(error.what());
            }
        }

        void writeResults() {
            if (options_.output.empty()) return;
            std::ofstream metadata(options_.output / "run.txt");
            metadata << "pid=" << GetCurrentProcessId() << "\nscenario=" << options_.scenario << "\nengine=" << engineName_ << "\nd2d1=" << d2dPath_ << "\nlogical_size=" << options_.width << 'x' << options_.height << "\nseconds_per_phase=" << options_.seconds << "\nwheel_delta=" << options_.wheelDelta << "\nwheel_interval_ms=" << options_.wheelInterval << "\ntoggle_interval_ms=" << options_.toggleInterval << "\nerror=" << error_ << "\n";
            if (window_ && window_->getPeer()) metadata << "peer_scale=" << window_->getPeer()->getPlatformScaleFactor() << "\n";
            if (hwnd_) metadata << "window_dpi=" << GetDpiForWindow(hwnd_) << "\n";
            metadata << "input_records=" << inputs_.size() << "\nframe_records=" << frames_.size() << "\n";
            for (const auto& cpu : processCpu_) metadata << cpu.first << "_process_cpu_ms=" << cpu.second << '\n';
            for (const auto* action : {"wheel", "toggle-animation"}) metadata << action << "_input_count=" << std::count_if(inputs_.begin(), inputs_.end(), [&](const auto& record) { return record.action == action; }) << '\n';
            for (const auto* key : {"ARRANGE_BITMAP_NATIVE", "ARRANGE_SVG_MASK_CACHE"}) {
                const auto value = ::juce::SystemStats::getEnvironmentVariable(key, "<default>");
                metadata << key << "_env=" << value.toStdString() << '\n';
                metadata << key << "_enabled=" << (value != "0") << '\n';
            }
            metadata << "ARRANGE_RENDER_METRICS=" << ::juce::SystemStats::getEnvironmentVariable("ARRANGE_RENDER_METRICS", "<default>").toStdString() << '\n';
            for (const auto* name : {"home", "animation"}) {
                std::uint64_t count = 0, placed = 0, maximumPaints = 0;
                std::size_t minimumNodes = ~std::size_t{0}, maximumNodes = 0;
                for (const auto& entry : frames_) {
                    if (entry.second.phase != name) continue;
                    const auto& frame = entry.second.record;
                    ++count;
                    placed += frame.placedNodes;
                    minimumNodes = std::min(minimumNodes, frame.nodes);
                    maximumNodes = std::max(maximumNodes, frame.nodes);
                    maximumPaints = std::max(maximumPaints, frame.render.paints);
                }
                metadata << name << "_published_records=" << count << '\n' << name << "_placed_nodes=" << placed << '\n' << name << "_min_nodes=" << (count ? minimumNodes : 0) << '\n' << name << "_max_nodes=" << maximumNodes << '\n' << name << "_cumulative_paints=" << maximumPaints << '\n';
            }
            metadata << "measurement=CPU调用墙钟耗时；time_ms为发布帧时间，非呈现时间；render列为累计快照差分，保留字节为末值；音频设备未启动\n";
            std::ofstream inputOutput(options_.output / "inputs.csv");
            inputOutput << "time_ms,phase,action,screen_x,screen_y,wheel_delta\n" << std::fixed << std::setprecision(6);
            for (const auto& input : inputs_) inputOutput << input.time << ',' << input.phase << ',' << input.action << ',' << input.x << ',' << input.y << ',' << input.delta << '\n';
            std::ofstream output(options_.output / "frames.csv");
            output << "phase,sequence,revision,time_ms,failed,pipeline_cpu_ms,paint_cpu_ms,measure_ms,place_ms,draw_prepare_ms,paint_build_ms,hit_build_ms,measured_nodes,placed_nodes,fragments_built,fragments_reused,draw_records,repaint_full,repaint_rects";
#define ARRANGE_BENCH_METRICS(X) \
    X(paints) X(bitmapHits) X(bitmapBuilds) X(bitmapEvictions) X(nativeConversions) X(nativeBytes) X(svgMaskBuilds) X(svgMaskHits) X(bitmapBuildMillis) X(nativeConvertMillis) X(svgMaskMillis)
#define ARRANGE_BENCH_HEADER(name) output << "," #name;
            ARRANGE_BENCH_METRICS(ARRANGE_BENCH_HEADER)
#undef ARRANGE_BENCH_HEADER
            output << ",bitmap_retained_bytes\n" << std::fixed << std::setprecision(6);
            arrange::core::RenderFrameMetrics previous;
            for (const auto& entry : frames_) {
                const auto& frame = entry.second.record;
                output << entry.second.phase << ',' << frame.sequence << ',' << frame.revision << ',' << frame.timeMillis << ',' << frame.failed << ',' << frame.millis.total << ',' << frame.millis.paint << ',' << frame.millis.measure << ',' << frame.millis.place << ',' << frame.millis.drawPrepare << ',' << frame.millis.paintBuild << ',' << frame.millis.hitBuild << ',' << frame.measuredNodes << ',' << frame.placedNodes << ',' << frame.fragmentsBuilt << ',' << frame.fragmentsReused << ',' << frame.drawRecords << ',' << frame.repaint.full << ',' << frame.repaint.rects.size();
#define ARRANGE_BENCH_VALUE(name) output << ',' << (frame.render.paints == 0 ? 0 : (frame.render.name >= previous.name ? frame.render.name - previous.name : frame.render.name));
                ARRANGE_BENCH_METRICS(ARRANGE_BENCH_VALUE)
#undef ARRANGE_BENCH_VALUE
                output << ',' << frame.render.bitmapRetainedBytes << '\n';
                if (frame.render.paints != 0) previous = frame.render;
            }
#undef ARRANGE_BENCH_METRICS
            if (!metadata || !inputOutput || !output) throw std::runtime_error("基准结果写入失败");
        }

        void validateResults() const {
            std::uint64_t painted = 0, animationFrames = 0, animationPlaced = 0, homePlaced = 0;
            std::size_t minimumNodes = ~std::size_t{0}, maximumNodes = 0;
            for (const auto& entry : frames_) {
                const auto& frame = entry.second.record;
                if (frame.failed) throw std::runtime_error("测试过程中出现失败发布帧");
                painted = std::max(painted, frame.render.paints);
                if (entry.second.phase == "home") homePlaced += frame.placedNodes;
                if (entry.second.phase == "animation") {
                    ++animationFrames;
                    animationPlaced += frame.placedNodes;
                    minimumNodes = std::min(minimumNodes, frame.nodes);
                    maximumNodes = std::max(maximumNodes, frame.nodes);
                }
            }
            if (painted == 0) throw std::runtime_error("没有采集到 render.paints，不能把本轮作为重放性能结果");
            if (options_.scenario != "animation" && homePlaced == 0) throw std::runtime_error("首页滚轮输入未产生布局放置变化");
            if (options_.scenario != "home" && (animationFrames < 3 || (animationPlaced == 0 && minimumNodes == maximumNodes))) throw std::runtime_error("SendInput 已发送，但未观察到全部播放触发的动画或节点结构变化");
        }

        void finish() {
            collect();
            validateResults();
            stopTimer();
            writeResults();
            stage_ = Stage::Done;
            std::cout << "基准完成，记录 " << frames_.size() << " 个发布帧，输入 " << inputs_.size() << " 次，结果=" << options_.output.string() << '\n';
            setApplicationReturnValue(0);
            quit();
        }

        void fail(const std::string& message) {
            if (stage_ == Stage::Done) return;
            stopTimer();
            error_ = message;
            stopMeasuredInputs(true);
            std::cerr << "真实窗口基准失败：" << message << '\n';
            try {
                collect();
                writeResults();
            } catch (const std::exception& outputError) {
                std::cerr << "保存失败信息时出错：" << outputError.what() << '\n';
            }
            stage_ = Stage::Done;
            setApplicationReturnValue(1);
            quit();
        }

        Options options_;
        std::unique_ptr<Processor> processor_;
        std::unique_ptr<arrange::juce::Interop> interop_;
        std::unique_ptr<arrange::juce::ArrangeEditor> editor_;
        std::unique_ptr<Window> window_;
        HWND hwnd_ = nullptr;
        HANDLE watchdogStop_ = nullptr;
        std::thread watchdog_;
        HANDLE inputStop_ = nullptr;
        std::thread inputThread_;
        // 工作线程只写此缓冲，消息线程在 join 后读取
        std::vector<InputRecord> workerInputs_;
        std::string workerError_;
        std::string measuredPhase_;
        double processCpuStart_ = 0;
        std::map<std::string, double> processCpu_;
        Stage stage_ = Stage::Ready;
        double started_ = 0;
        double stageStart_ = 0;
        double nextInput_ = 0;
        int engine_ = -1;
        std::string engineName_;
        std::string d2dPath_;
        std::string error_;
        ::juce::Point<float> toggle_;
        std::uint64_t lastCapturedSequence_ = 0;
        std::map<std::uint64_t, CapturedFrame> frames_;
        std::vector<InputRecord> inputs_;
    };
}

START_JUCE_APPLICATION(Application)
