add_executable(arrange_core_smoke arrange_core_smoke.cpp)
target_link_libraries(arrange_core_smoke PRIVATE arrange_core arrange_juce arrange_quickjs)
add_test(NAME arrange_core_smoke COMMAND arrange_core_smoke)

if(TARGET qjs)
  add_executable(arrange_quickjs_app_smoke arrange_quickjs_app_smoke.cpp)
  target_link_libraries(arrange_quickjs_app_smoke PRIVATE arrange_core arrange_quickjs)
  add_test(NAME arrange_quickjs_app_smoke COMMAND arrange_quickjs_app_smoke)
endif()
