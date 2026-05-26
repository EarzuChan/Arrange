cmake_minimum_required(VERSION 3.24)
project(ArrangeDemoPlugin LANGUAGES C CXX)

if(NOT TARGET Arrange::framework)
  set(ARRANGE_DEMO_ARRANGE_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/../.." CACHE PATH "Arrange source tree for the demo user-sample build")
  if(NOT EXISTS "${ARRANGE_DEMO_ARRANGE_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "ARRANGE_DEMO_ARRANGE_SOURCE_DIR must point to an Arrange source tree")
  endif()
  set(ARRANGE_BUILD_TESTS OFF CACHE BOOL "Do not build Arrange tests from the demo user-sample" FORCE)
  add_subdirectory("${ARRANGE_DEMO_ARRANGE_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/_deps/arrange-build")
endif()

if(NOT TARGET juce::juce_core)
  message(FATAL_ERROR "Arrange demo requires JUCE from Arrange::framework.")
endif()

juce_add_plugin(ArrangeDemoPlugin
  VERSION 0.0.0
  COMPANY_NAME "Arrange"
  PLUGIN_MANUFACTURER_CODE Arng
  PLUGIN_CODE ArD1
  FORMATS Standalone VST3
  PRODUCT_NAME "Arrange Demo"
  IS_SYNTH FALSE
  NEEDS_MIDI_INPUT FALSE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS TRUE
  COPY_PLUGIN_AFTER_BUILD FALSE
)
juce_generate_juce_header(ArrangeDemoPlugin)

target_sources(ArrangeDemoPlugin PRIVATE
  Source/DemoProcessor.cpp
)

target_compile_definitions(ArrangeDemoPlugin PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
)
target_compile_definitions(ArrangeDemoPlugin PUBLIC
  JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(ArrangeDemoPlugin PRIVATE
  Arrange::framework
  juce::juce_audio_utils
  juce::juce_dsp
  juce::juce_recommended_config_flags
  juce::juce_recommended_lto_flags
  juce::juce_recommended_warning_flags
)

if(DEFINED ARRANGE_DEMO_UI_DIST_DIR AND NOT ARRANGE_DEMO_UI_DIST_DIR STREQUAL "")
  foreach(format_target IN ITEMS ArrangeDemoPlugin_Standalone ArrangeDemoPlugin_VST3)
    if(TARGET ${format_target})
      add_custom_command(TARGET ${format_target} POST_BUILD
        COMMAND ${CMAKE_COMMAND}
                -DARRANGE_DEMO_UI_DIST_DIR=${ARRANGE_DEMO_UI_DIST_DIR}
                -DARRANGE_DEMO_TARGET_FILE_DIR=$<TARGET_FILE_DIR:${format_target}>
                -P ${CMAKE_CURRENT_LIST_DIR}/../../cmake/copy-demo-ui-dist.cmake
        VERBATIM
      )
    endif()
  endforeach()
endif()
