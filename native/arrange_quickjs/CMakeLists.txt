add_library(arrange_quickjs STATIC
  src/AppScriptLoader.cpp
  src/CallbackRegistry.cpp
)

target_include_directories(arrange_quickjs PUBLIC include)
target_link_libraries(arrange_quickjs PUBLIC arrange_core)

if(TARGET qjs)
  target_sources(arrange_quickjs PRIVATE src/QuickJsScriptHost.cpp)
  target_compile_definitions(arrange_quickjs PUBLIC ARRANGE_WITH_QUICKJS_NG=1)
  target_link_libraries(arrange_quickjs PUBLIC qjs)
else()
  target_compile_definitions(arrange_quickjs PUBLIC ARRANGE_WITH_QUICKJS_NG=0)
endif()
