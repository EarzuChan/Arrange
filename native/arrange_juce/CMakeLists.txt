add_library(arrange_juce STATIC
  src/AppResolver.cpp
  src/DevServerClient.cpp
  src/ErrorScreenModel.cpp
  src/HeadlessArrangeEditor.cpp
)

target_include_directories(arrange_juce PUBLIC include)
target_link_libraries(arrange_juce PUBLIC arrange_core arrange_quickjs)

if(TARGET juce::juce_audio_processors)
  target_sources(arrange_juce PRIVATE
    src/ArrangeEditor.cpp
    src/DiagnosticsOverlay.cpp
    src/ImageResourceCache.cpp
    src/InputTextSession.cpp
    src/InputTextController.cpp
    src/JuceDrawOpsPainter.cpp
    src/JuceTextServices.cpp
    src/RuntimePackageLoader.cpp
    src/ScriptEventBridge.cpp
  )
  target_compile_definitions(arrange_juce PUBLIC ARRANGE_JUCE_WITH_JUCE=1)
  target_link_libraries(arrange_juce PUBLIC
    juce::juce_audio_processors
    juce::juce_gui_basics
  )
else()
  target_compile_definitions(arrange_juce PUBLIC ARRANGE_JUCE_WITH_JUCE=0)
endif()
