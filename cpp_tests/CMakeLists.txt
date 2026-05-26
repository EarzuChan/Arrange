add_executable(arrange_core_smoke arrange_core_smoke.cpp)
target_link_libraries(arrange_core_smoke PRIVATE Arrange::framework)
add_test(NAME arrange_core_smoke COMMAND arrange_core_smoke)

if(TARGET qjs)
  add_executable(arrange_quickjs_app_smoke arrange_quickjs_app_smoke.cpp)
  target_link_libraries(arrange_quickjs_app_smoke PRIVATE Arrange::core Arrange::quickjs)
  add_test(NAME arrange_quickjs_app_smoke COMMAND arrange_quickjs_app_smoke)
endif()

if(TARGET juce::juce_audio_processors AND TARGET qjs)
  add_executable(arrange_juce_runtime_smoke arrange_juce_runtime_smoke.cpp)
  target_link_libraries(arrange_juce_runtime_smoke PRIVATE Arrange::framework)
  add_test(
    NAME arrange_juce_runtime_smoke
    COMMAND arrange_juce_runtime_smoke "${CMAKE_SOURCE_DIR}/build/demo-ui-dist/app.js"
  )
endif()
