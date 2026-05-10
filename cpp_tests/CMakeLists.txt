add_executable(arrange_core_smoke arrange_core_smoke.cpp)
target_link_libraries(arrange_core_smoke PRIVATE arrange_core arrange_juce arrange_quickjs)
add_test(NAME arrange_core_smoke COMMAND arrange_core_smoke)

if(TARGET qjs)
  add_executable(arrange_quickjs_app_smoke arrange_quickjs_app_smoke.cpp)
  target_link_libraries(arrange_quickjs_app_smoke PRIVATE arrange_core arrange_quickjs)
  add_test(NAME arrange_quickjs_app_smoke COMMAND arrange_quickjs_app_smoke)
endif()

if(TARGET juce::juce_audio_processors AND TARGET qjs)
  add_executable(arrange_juce_runtime_smoke arrange_juce_runtime_smoke.cpp)
  target_link_libraries(arrange_juce_runtime_smoke PRIVATE arrange_core arrange_juce arrange_quickjs)
  add_test(
    NAME arrange_juce_runtime_smoke
    COMMAND arrange_juce_runtime_smoke "${CMAKE_SOURCE_DIR}/demo/plugin-src/ui/app.ts"
  )
endif()
