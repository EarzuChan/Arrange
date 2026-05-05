cmake_minimum_required(VERSION 3.24)

if(NOT TARGET juce::juce_core)
  message(FATAL_ERROR "JUCE dependency must be prepared by arrange_fetch_juce() from cmake/Dependencies.cmake before adding demo/plugin-src")
endif()

juce_add_plugin(ArrangeDemoPlugin
  VERSION 0.1.0
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
  arrange_juce
  juce::juce_audio_utils
  juce::juce_dsp
  juce::juce_recommended_config_flags
  juce::juce_recommended_lto_flags
  juce::juce_recommended_warning_flags
)
