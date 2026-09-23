add_executable(arrange_core_smoke arrange_core_smoke.cpp)
target_link_libraries(arrange_core_smoke PRIVATE Arrange::framework)
add_test(NAME arrange_core_smoke COMMAND arrange_core_smoke)

add_executable(arrange_local_work arrange_local_work.cpp)
target_link_libraries(arrange_local_work PRIVATE Arrange::core)
add_test(NAME arrange_local_work COMMAND arrange_local_work)

add_executable(arrange_m24_contract arrange_m24_contract.cpp)
target_link_libraries(arrange_m24_contract PRIVATE Arrange::framework)
add_test(NAME arrange_m24_contract COMMAND arrange_m24_contract)

if(TARGET qjs)
  add_executable(arrange_live_modules arrange_live_modules.cpp)
  target_link_libraries(arrange_live_modules PRIVATE Arrange::quickjs)
  add_test(NAME arrange_live_modules COMMAND arrange_live_modules)
  add_executable(arrange_quickjs_app_smoke arrange_quickjs_app_smoke.cpp)
  target_link_libraries(arrange_quickjs_app_smoke PRIVATE Arrange::framework)
  add_test(NAME arrange_quickjs_app_smoke COMMAND arrange_quickjs_app_smoke "${CMAKE_SOURCE_DIR}/build/demo-ui-dist/app.js")
endif()

if(TARGET juce::juce_audio_processors AND TARGET qjs)
  add_executable(arrange_live_server arrange_live_server.cpp)
  target_link_libraries(arrange_live_server PRIVATE Arrange::framework)
  add_executable(arrange_juce_runtime_smoke arrange_juce_runtime_smoke.cpp)
  target_link_libraries(arrange_juce_runtime_smoke PRIVATE Arrange::framework)
  add_test(
    NAME arrange_juce_runtime_smoke
    COMMAND arrange_juce_runtime_smoke "${CMAKE_SOURCE_DIR}/build/demo-ui-dist/app.js"
  )
endif()

add_executable(arrange_modifier_runtime arrange_modifier_runtime.cpp)
target_link_libraries(arrange_modifier_runtime PRIVATE Arrange::core)
add_test(NAME arrange_modifier_runtime COMMAND arrange_modifier_runtime)

add_executable(arrange_quickjs_modifier arrange_quickjs_modifier.cpp)
target_link_libraries(arrange_quickjs_modifier PRIVATE Arrange::quickjs)
add_test(NAME arrange_quickjs_modifier COMMAND arrange_quickjs_modifier)

add_executable(arrange_slot_runtime arrange_slot_runtime.cpp)
target_link_libraries(arrange_slot_runtime PRIVATE Arrange::core)
add_test(NAME arrange_slot_runtime COMMAND arrange_slot_runtime)

add_executable(arrange_frame_submission arrange_frame_submission.cpp)
target_link_libraries(arrange_frame_submission PRIVATE Arrange::framework)
add_test(NAME arrange_frame_submission COMMAND arrange_frame_submission)

if(TARGET juce::juce_audio_processors AND TARGET qjs)
  find_program(ARRANGE_NODE_EXECUTABLE node REQUIRED)
  file(GLOB_RECURSE ARRANGE_RUNTIME_FIXTURE_INPUTS CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/packages/*/src/*.ts"
    "${CMAKE_SOURCE_DIR}/tests/fixtures/rearrange-runtime/*"
    "${CMAKE_SOURCE_DIR}/tests/fixtures/viewport-runtime/*"
    "${CMAKE_SOURCE_DIR}/demo/ui-src/src/view/*.sfa")
  add_custom_command(
    OUTPUT "${CMAKE_SOURCE_DIR}/build/rearrange-runtime-fixture/app.js" "${CMAKE_SOURCE_DIR}/build/viewport-runtime-fixture/app.js"
    COMMAND "${ARRANGE_NODE_EXECUTABLE}" --import tsx scripts/build-runtime-fixtures.ts
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    DEPENDS ${ARRANGE_RUNTIME_FIXTURE_INPUTS} "${CMAKE_SOURCE_DIR}/scripts/build-runtime-fixtures.ts"
    COMMENT "编译 Arrange SFA 原生运行夹具")
  add_custom_target(arrange_runtime_fixture DEPENDS "${CMAKE_SOURCE_DIR}/build/rearrange-runtime-fixture/app.js" "${CMAKE_SOURCE_DIR}/build/viewport-runtime-fixture/app.js")
  add_executable(arrange_rearrange_runtime arrange_rearrange_runtime.cpp AllocationProbe.cpp)
  target_link_libraries(arrange_rearrange_runtime PRIVATE Arrange::framework)
  add_dependencies(arrange_rearrange_runtime arrange_runtime_fixture)
  add_test(NAME arrange_rearrange_runtime COMMAND arrange_rearrange_runtime "${CMAKE_SOURCE_DIR}/build/rearrange-runtime-fixture/app.js")
  add_executable(arrange_viewport_runtime arrange_viewport_runtime.cpp)
  target_link_libraries(arrange_viewport_runtime PRIVATE Arrange::framework)
  add_dependencies(arrange_viewport_runtime arrange_runtime_fixture)
  add_test(NAME arrange_viewport_runtime COMMAND arrange_viewport_runtime "${CMAKE_SOURCE_DIR}/build/viewport-runtime-fixture/app.js")
endif()

if(TARGET juce::juce_audio_processors)
  add_executable(arrange_retained_paint arrange_retained_paint.cpp)
  target_link_libraries(arrange_retained_paint PRIVATE Arrange::framework)
  add_test(NAME arrange_retained_paint COMMAND arrange_retained_paint)
endif()
