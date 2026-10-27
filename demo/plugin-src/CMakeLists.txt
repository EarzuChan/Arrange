cmake_minimum_required(VERSION 3.24)
project(ArrangeDemoPlugin LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# arrange:begin cluster:cmake.fetch-content
include(FetchContent)
FetchContent_Declare(arrange
# arrange:begin region:cmake.fetch-content-repository
    GIT_REPOSITORY "https://github.com/EarzuChan/Arrange.git"
# arrange:end region:cmake.fetch-content-repository
# arrange:begin region:cmake.framework-version
    GIT_TAG "v0.4.1"
# arrange:end region:cmake.framework-version
)
FetchContent_MakeAvailable(arrange)
# arrange:end cluster:cmake.fetch-content

# arrange:begin cluster:cmake.product-settings
# arrange:begin region:cmake.bundle-id
if(APPLE)
    set(_arrange_bundle_id "com.arrange.arrangedemo")
else()
    set(_arrange_bundle_id "com.arrange.arrangedemo")
endif()
# arrange:end region:cmake.bundle-id
# arrange:end cluster:cmake.product-settings

# arrange:begin cluster:cmake.juce-plugin
juce_add_plugin(ArrangeDemoPlugin
# arrange:begin region:cmake.plugin-version
    VERSION "0.1.0"
# arrange:end region:cmake.plugin-version
# arrange:begin region:cmake.plugin-identity
    COMPANY_NAME "Arrange"
    PLUGIN_MANUFACTURER_CODE Arng
    PLUGIN_CODE ArD1
    BUNDLE_ID "${_arrange_bundle_id}"
# arrange:end region:cmake.plugin-identity
# arrange:begin region:cmake.plugin-formats
    FORMATS Standalone VST3
# arrange:end region:cmake.plugin-formats
# arrange:begin region:cmake.product-name
    PRODUCT_NAME "Arrange Demo"
    PLUGIN_NAME "Arrange Demo"
# arrange:end region:cmake.product-name
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
)
# arrange:end cluster:cmake.juce-plugin

# arrange:begin cluster:cmake.product-assets
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/arrange-presentation.cpp" CONTENT "namespace { [[maybe_unused]] constexpr char arrangePresentation[] = \"${ARRANGE_CLI_PRESENTATION_SIGNATURE}\"; }\n" @ONLY)
get_target_property(_arrange_icon_big ArrangeDemoPlugin JUCE_ICON_BIG)
get_target_property(_arrange_icon_small ArrangeDemoPlugin JUCE_ICON_SMALL)
if((ARRANGE_CLI_ICON_ICO OR ARRANGE_CLI_ICON_ICNS) AND (_arrange_icon_big OR _arrange_icon_small))
    message(FATAL_ERROR "CLI 图标与 JUCE ICON_BIG/ICON_SMALL 冲突，请移除 project.icon 并自行维护图标接入，或移除手工 ICON_BIG/ICON_SMALL")
endif()
set(_arrange_keep_manual_icon FALSE)
if(_arrange_icon_big OR _arrange_icon_small)
    set(_arrange_keep_manual_icon TRUE)
endif()
foreach(_arrange_product IN ITEMS ArrangeDemoPlugin_Standalone ArrangeDemoPlugin_VST3)
    if(NOT TARGET ${_arrange_product})
        continue()
    endif()
    get_target_property(_arrange_product_source ${_arrange_product} SOURCE_DIR)
    if(NOT _arrange_product_source STREQUAL CMAKE_CURRENT_SOURCE_DIR)
        message(FATAL_ERROR "CLI 托管产品图标资源段必须与 juce_add_plugin 位于同一 CMake 目录（目标：${_arrange_product}）；请将资源段移到目标定义目录，或取消 cmake.product-icon 托管并自行维护图标接入")
    endif()
    target_sources(${_arrange_product} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/arrange-presentation.cpp")
    if(APPLE)
        if(ARRANGE_CLI_ICON_ICNS)
            configure_file("${ARRANGE_CLI_ICON_ICNS}" "${CMAKE_CURRENT_BINARY_DIR}/ArrangeIcon.icns" COPYONLY)
            target_sources(${_arrange_product} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/ArrangeIcon.icns")
            set_source_files_properties("${CMAKE_CURRENT_BINARY_DIR}/ArrangeIcon.icns" PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
        else()
            add_custom_command(TARGET ${_arrange_product} POST_BUILD
                COMMAND "${CMAKE_COMMAND}" -E rm -f "$<TARGET_BUNDLE_CONTENT_DIR:${_arrange_product}>/Resources/ArrangeIcon.icns"
                VERBATIM)
        endif()
    elseif(WIN32)
        if(_arrange_product STREQUAL "ArrangeDemoPlugin_Standalone")
            if(ARRANGE_CLI_ICON_ICO)
                file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/arrange-icon.rc" "#pragma code_page(65001)\n101 ICON \"${ARRANGE_CLI_ICON_ICO}\"\n")
                target_sources(${_arrange_product} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/arrange-icon.rc")
            endif()
        elseif(ARRANGE_CLI_ICON_ICO)
            file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/arrange-desktop.ini" CONTENT "[.ShellClassInfo]\nIconResource=Plugin.ico,0\nIconFile=Plugin.ico\nIconIndex=0\n" @ONLY NEWLINE_STYLE CRLF)
            add_custom_command(TARGET ${_arrange_product} POST_BUILD
                COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${ARRANGE_CLI_ICON_ICO}" "$<TARGET_FILE_DIR:${_arrange_product}>/../../Plugin.ico"
                COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${CMAKE_CURRENT_BINARY_DIR}/arrange-desktop.ini" "$<TARGET_FILE_DIR:${_arrange_product}>/../../desktop.ini"
                COMMAND "${CMAKE_COMMAND}" -E touch "$<TARGET_FILE_DIR:${_arrange_product}>/../../.arrange-icon"
                COMMAND attrib +s +h "$<TARGET_FILE_DIR:${_arrange_product}>/../../desktop.ini"
                COMMAND attrib +s "$<TARGET_FILE_DIR:${_arrange_product}>/../.."
                VERBATIM)
        else()
            file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/arrange-clear-icon.cmake" [=[
if(EXISTS "${BUNDLE_DIRECTORY}/.arrange-icon")
    if(NOT KEEP_MANUAL_ICON)
        if(EXISTS "${BUNDLE_DIRECTORY}/desktop.ini")
            execute_process(COMMAND attrib -s -h "${BUNDLE_DIRECTORY}/desktop.ini" COMMAND_ERROR_IS_FATAL ANY)
        endif()
        execute_process(COMMAND attrib -s "${BUNDLE_DIRECTORY}" COMMAND_ERROR_IS_FATAL ANY)
        file(REMOVE "${BUNDLE_DIRECTORY}/Plugin.ico" "${BUNDLE_DIRECTORY}/desktop.ini")
    endif()
    file(REMOVE "${BUNDLE_DIRECTORY}/.arrange-icon")
endif()
]=])
            add_custom_command(TARGET ${_arrange_product} POST_BUILD
                COMMAND "${CMAKE_COMMAND}" "-DBUNDLE_DIRECTORY=$<TARGET_FILE_DIR:${_arrange_product}>/../.." "-DKEEP_MANUAL_ICON=${_arrange_keep_manual_icon}" -P "${CMAKE_CURRENT_BINARY_DIR}/arrange-clear-icon.cmake"
                VERBATIM)
        endif()
    endif()
endforeach()
# arrange:end cluster:cmake.product-assets

juce_generate_juce_header(ArrangeDemoPlugin)
target_sources(ArrangeDemoPlugin PRIVATE "Source/DemoProcessor.cpp")
target_compile_definitions(ArrangeDemoPlugin PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_compile_definitions(ArrangeDemoPlugin PUBLIC JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(ArrangeDemoPlugin PRIVATE
    Arrange::framework
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
