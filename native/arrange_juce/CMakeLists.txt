add_library(arrange_juce STATIC
  src/AppResolver.cpp
  src/DevServerClient.cpp
  src/ErrorScreenModel.cpp
  src/FramePlanner.cpp
  src/HeadlessArrangeEditor.cpp
  src/ScenePipelineState.cpp
)

add_library(Arrange::juce ALIAS arrange_juce)
target_include_directories(arrange_juce PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_link_libraries(arrange_juce PUBLIC Arrange::core Arrange::quickjs)

if(NOT TARGET juce::juce_audio_processors)
  message(FATAL_ERROR "arrange_juce requires JUCE target juce::juce_audio_processors. Use the Arrange root CMake project or provide JUCE before adding this module.")
endif()

target_sources(arrange_juce PRIVATE
  src/ArrangeEditor.cpp
  src/ArrangeRuntime.cpp
  src/EditorChromeModel.cpp
  src/CompositionHost.cpp
  src/DiagnosticEvent.cpp
  src/DiagnosticsState.cpp
  src/DiagnosticsModel.cpp
  src/DiagnosticsScene.cpp
  src/EditorDebugActions.cpp
  src/EditorFrameClock.cpp
  src/EditorSceneHost.cpp
  src/EditorTimerDriver.cpp
  src/FramePumpDriver.cpp
  src/ImageResourceCache.cpp
  src/InteractionStateOwner.cpp
  src/TextInputOwner.cpp
  src/TextInputMutationSink.cpp
  src/InputTextSession.cpp
  src/TextInputLayoutModel.cpp
  src/JuceDrawOpsPainter.cpp
  src/JuceTextServices.cpp
  src/PackageRuntimeSource.cpp
  src/PassivePaintRenderer.cpp
  src/JucePointerInputAdapter.cpp
  src/PointerInputState.cpp
  src/JuceRepaintAdapter.cpp
  src/RuntimePackageBinder.cpp
  src/RuntimeSessionState.cpp
  src/RuntimePackageLoader.cpp
  src/ScriptEventDispatcher.cpp
  src/JuceTextInputAdapter.cpp
)
target_compile_definitions(arrange_juce PUBLIC ARRANGE_JUCE_WITH_JUCE=1)
target_link_libraries(arrange_juce PUBLIC
  juce::juce_audio_processors
  juce::juce_gui_basics
)
