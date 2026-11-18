add_library(arrange_quickjs STATIC)

add_library(Arrange::quickjs ALIAS arrange_quickjs)
target_include_directories(arrange_quickjs PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_link_libraries(arrange_quickjs PUBLIC Arrange::core)

if(NOT TARGET qjs)
  message(FATAL_ERROR "arrange_quickjs requires QuickJS-NG target qjs. Use the Arrange root CMake project or provide QuickJS-NG before adding this module.")
endif()

target_sources(arrange_quickjs PRIVATE
  src/QuickJsEventRegistry.cpp
  src/QuickJsModifierReader.cpp
  src/QuickJsModuleLoader.cpp
  src/QuickJsHotTransport.cpp
  src/QuickJsNativeApi.cpp
  src/Log.cpp
  src/QuickJsPainterResources.cpp
  src/QuickJsInterop.cpp
  src/QuickJsRuntimeContext.cpp
  src/QuickJsScriptHeap.cpp
  src/QuickJsScriptHost.cpp
  src/QuickJsValueReader.cpp
)
target_compile_definitions(arrange_quickjs PUBLIC ARRANGE_WITH_QUICKJS_NG=1)
target_link_libraries(arrange_quickjs PUBLIC qjs)

# Hash the actual linked engine artifact, including local source overrides and build flags.
set(identity_dir "${CMAKE_BINARY_DIR}/arrange-quickjs-identity/$<CONFIG>")
add_custom_command(
  OUTPUT "${identity_dir}/QuickJsBuildIdentity.h" "${identity_dir}/identity.txt"
  COMMAND "${CMAKE_COMMAND}" "-DINPUT=$<TARGET_FILE:qjs>" "-DOUTPUT=${identity_dir}"
    -P "${PROJECT_SOURCE_DIR}/cmake/QuickJsBuildIdentity.cmake"
  DEPENDS qjs "${PROJECT_SOURCE_DIR}/cmake/QuickJsBuildIdentity.cmake"
  VERBATIM
)
add_custom_target(arrange_quickjs_identity DEPENDS "${identity_dir}/QuickJsBuildIdentity.h" "${identity_dir}/identity.txt")
add_dependencies(arrange_quickjs arrange_quickjs_identity)
target_include_directories(arrange_quickjs PRIVATE "${identity_dir}")

add_executable(arrange_ui_bytecode EXCLUDE_FROM_ALL tools/UiBytecode.cpp)
add_dependencies(arrange_ui_bytecode arrange_quickjs_identity)
target_include_directories(arrange_ui_bytecode PRIVATE "${identity_dir}" src)
target_link_libraries(arrange_ui_bytecode PRIVATE qjs)
