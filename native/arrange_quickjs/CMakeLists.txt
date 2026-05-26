add_library(arrange_quickjs STATIC
  src/AppScriptLoader.cpp
)

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
  src/QuickJsNativeApi.cpp
  src/QuickJsRuntimeContext.cpp
  src/QuickJsScriptHost.cpp
  src/QuickJsValueReader.cpp
)
target_compile_definitions(arrange_quickjs PUBLIC ARRANGE_WITH_QUICKJS_NG=1)
target_link_libraries(arrange_quickjs PUBLIC qjs)
