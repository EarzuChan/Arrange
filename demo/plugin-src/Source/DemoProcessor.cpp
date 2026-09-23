#include "DemoProcessor.h"

#include <arrange/juce/ArrangeEditor.h>
#include <utility>

#if !defined(NDEBUG) && JUCE_STANDALONE_APPLICATION && defined(_WIN32)
#include <cstdio>
#include <windows.h>

namespace {
    class DiagnosticConsoleSink final : public juce::Logger {
       public:
        void logMessage(const juce::String& message) override {
            const auto handle = GetStdHandle(STD_OUTPUT_HANDLE);

            WORD attributes = FOREGROUND_INTENSITY | FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_BLUE;
            if (message.contains("[trace]")) attributes = FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_BLUE;
            else if (message.contains("[debug]")) attributes = FOREGROUND_INTENSITY | FOREGROUND_BLUE | FOREGROUND_GREEN;
            else if (message.contains("[info]")) attributes = FOREGROUND_INTENSITY | FOREGROUND_GREEN;
            else if (message.contains("[warn]")) attributes = FOREGROUND_INTENSITY | FOREGROUND_RED | FOREGROUND_GREEN;
            else if (message.contains("[error]")) attributes = FOREGROUND_INTENSITY | FOREGROUND_RED;
            SetConsoleTextAttribute(handle, attributes);

            std::fputs(message.toRawUTF8(), stdout);
            std::fputc('\n', stdout);
            std::fflush(stdout);

            SetConsoleTextAttribute(handle, FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_BLUE);
        }
    };

    void configureDebugConsole() {
        FreeConsole(); // 放走老控制台

        AllocConsole(); // 拉来一个船新控制台
        SetConsoleTitleW(L"Arrange Demo - native log");

        FILE* stream = nullptr;
        freopen_s(&stream, "CONOUT$", "w", stdout);
        freopen_s(&stream, "CONOUT$", "w", stderr);

        static DiagnosticConsoleSink sink;
        juce::Logger::setCurrentLogger(&sink);
    }
}
#endif

ArrangeDemoProcessor::ArrangeDemoProcessor() : juce::AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true).withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

void ArrangeDemoProcessor::prepareToPlay(double, int) {}

bool ArrangeDemoProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet() == layouts.getMainOutputChannelSet();
}

void ArrangeDemoProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    for (int channel = getTotalNumInputChannels(); channel < getTotalNumOutputChannels(); ++channel) buffer.clear(channel, 0, buffer.getNumSamples());
}

juce::AudioProcessorEditor* ArrangeDemoProcessor::createEditor() {
#if !defined(NDEBUG) && JUCE_STANDALONE_APPLICATION && defined(_WIN32)
    configureDebugConsole();
#endif

    arrange::juce::EditorConfig config;

    config.app.useDist();
    config.width = 900;
    config.height = 780;
    config.window.title = "Arrange 原生画廊";
    config.window.resizable = true;
    config.window.useCornerResizer = true;
    config.window.minWidth = 420;
    config.window.minHeight = 300;
#if !defined(NDEBUG)
    config.app.useLive();
    config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Always;
    config.diagnostics.logLevel = arrange::juce::LogLevel::Trace;
    config.diagnostics.logFile.clear(); // 不需要每次调用
#endif

    return new arrange::juce::ArrangeEditor(*this, std::move(config));
}

void ArrangeDemoProcessor::getStateInformation(juce::MemoryBlock&) {}

void ArrangeDemoProcessor::setStateInformation(const void*, int) {}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new ArrangeDemoProcessor();
}
