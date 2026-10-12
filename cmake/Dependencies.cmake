include(FetchContent)

file(READ "${CMAKE_CURRENT_LIST_DIR}/NativeDependencies.json" _arrange_dependencies)
string(JSON _arrange_dependency_schema GET "${_arrange_dependencies}" schema)
if(NOT _arrange_dependency_schema EQUAL 1)
    message(FATAL_ERROR "Unsupported Arrange native dependency manifest schema")
endif()
foreach(_arrange_dependency IN ITEMS juce quickjs_ng)
    string(TOUPPER "${_arrange_dependency}" _arrange_dependency_name)
    string(JSON _arrange_repository GET "${_arrange_dependencies}" "${_arrange_dependency}" repository)
    string(JSON _arrange_ref GET "${_arrange_dependencies}" "${_arrange_dependency}" ref)
    set(ARRANGE_${_arrange_dependency_name}_GIT_REPOSITORY "${_arrange_repository}" CACHE STRING "Dependency git repository")
    set(ARRANGE_${_arrange_dependency_name}_GIT_TAG "${_arrange_ref}" CACHE STRING "Pinned dependency release tag")
endforeach()

function(arrange_validate_dependency name source)
    string(TOLOWER "${name}" _arrange_name)
    if(FETCHCONTENT_SOURCE_DIR_${name})
        return()
    endif()
    string(JSON _arrange_repository GET "${_arrange_dependencies}" "${_arrange_name}" repository)
    string(JSON _arrange_ref GET "${_arrange_dependencies}" "${_arrange_name}" ref)
    if(ARRANGE_${name}_GIT_REPOSITORY STREQUAL _arrange_repository AND ARRANGE_${name}_GIT_TAG STREQUAL _arrange_ref)
        string(JSON _arrange_commit GET "${_arrange_dependencies}" "${_arrange_name}" commit)
        find_package(Git REQUIRED QUIET)
        execute_process(COMMAND "${GIT_EXECUTABLE}" -C "${source}" rev-parse HEAD RESULT_VARIABLE _arrange_git_result OUTPUT_VARIABLE _arrange_actual_commit OUTPUT_STRIP_TRAILING_WHITESPACE)
        if(NOT _arrange_git_result EQUAL 0 OR NOT _arrange_actual_commit STREQUAL _arrange_commit)
            message(FATAL_ERROR "${name} checkout does not match the pinned Arrange dependency commit")
        endif()
    endif()
endfunction()

function(arrange_reject_unclean_dependency_path path label)
  if(NOT path)
    return()
  endif()
  get_filename_component(_arrange_dep_abs "${path}" ABSOLUTE)
  if(_arrange_dep_abs MATCHES "ArrangeOld|[/\\]_deps[/\\]")
    message(FATAL_ERROR "Refusing ${label}='${_arrange_dep_abs}'. Use a clean checkout or Arrange-owned FetchContent, not ArrangeOld or another project's CMake _deps cache.")
  endif()
endfunction()

function(arrange_fetch_juce)
  if(TARGET juce::juce_core)
    return()
  endif()

  arrange_reject_unclean_dependency_path("${FETCHCONTENT_SOURCE_DIR_JUCE}" "FETCHCONTENT_SOURCE_DIR_JUCE")
  arrange_reject_unclean_dependency_path("${JUCE_DIR}" "JUCE_DIR")

  if(DEFINED JUCE_DIR AND NOT JUCE_DIR STREQUAL "")
    get_filename_component(_arrange_juce_dir "${JUCE_DIR}" ABSOLUTE)
    message(STATUS "Using explicit clean JUCE checkout: ${_arrange_juce_dir}")
    add_subdirectory("${_arrange_juce_dir}" "${CMAKE_BINARY_DIR}/_deps/juce-build")
    return()
  endif()

  message(STATUS "Fetching JUCE ${ARRANGE_JUCE_GIT_TAG} from ${ARRANGE_JUCE_GIT_REPOSITORY}")
  FetchContent_Declare(juce
    GIT_REPOSITORY "${ARRANGE_JUCE_GIT_REPOSITORY}"
    GIT_TAG "${ARRANGE_JUCE_GIT_TAG}"
    GIT_SHALLOW TRUE
    GIT_PROGRESS TRUE
  )
  FetchContent_MakeAvailable(juce)
  arrange_validate_dependency(JUCE "${juce_SOURCE_DIR}")
endfunction()

function(arrange_fetch_quickjs_ng)
  # 解释器即使在 Debug 也优化，避免 MSVC 未优化解释循环耗尽插件宿主线程栈
  # 仅调整本函数添加的依赖目录，Arrange 自身保留完整 Debug 检查
  if(MSVC)
    string(REPLACE "/RTC1" "" CMAKE_C_FLAGS_DEBUG "${CMAKE_C_FLAGS_DEBUG}")
  endif()
  if(DEFINED ARRANGE_QUICKJS_NG_SOURCE_DIR AND NOT ARRANGE_QUICKJS_NG_SOURCE_DIR STREQUAL "")
    arrange_reject_unclean_dependency_path("${ARRANGE_QUICKJS_NG_SOURCE_DIR}" "ARRANGE_QUICKJS_NG_SOURCE_DIR")
  endif()
  arrange_reject_unclean_dependency_path("${FETCHCONTENT_SOURCE_DIR_QUICKJS_NG}" "FETCHCONTENT_SOURCE_DIR_QUICKJS_NG")

  if(TARGET qjs OR TARGET quickjs OR TARGET quickjs-ng)
    return()
  endif()

  if(DEFINED ARRANGE_QUICKJS_NG_SOURCE_DIR AND NOT ARRANGE_QUICKJS_NG_SOURCE_DIR STREQUAL "")
    get_filename_component(_arrange_qjs_dir "${ARRANGE_QUICKJS_NG_SOURCE_DIR}" ABSOLUTE)
    message(STATUS "Using explicit clean QuickJS-NG checkout: ${_arrange_qjs_dir}")
    add_subdirectory("${_arrange_qjs_dir}" "${CMAKE_BINARY_DIR}/_deps/quickjs-ng-build")
    if(MSVC)
      target_compile_options(qjs PRIVATE "$<$<CONFIG:Debug>:/O2>")
    endif()
    return()
  endif()

  message(STATUS "Fetching QuickJS-NG ${ARRANGE_QUICKJS_NG_GIT_TAG} from ${ARRANGE_QUICKJS_NG_GIT_REPOSITORY}")
  FetchContent_Declare(quickjs_ng
    GIT_REPOSITORY "${ARRANGE_QUICKJS_NG_GIT_REPOSITORY}"
    GIT_TAG "${ARRANGE_QUICKJS_NG_GIT_TAG}"
    GIT_SHALLOW TRUE
    GIT_PROGRESS TRUE
  )
  FetchContent_MakeAvailable(quickjs_ng)
  arrange_validate_dependency(QUICKJS_NG "${quickjs_ng_SOURCE_DIR}")
  if(MSVC)
    target_compile_options(qjs PRIVATE "$<$<CONFIG:Debug>:/O2>")
  endif()
endfunction()
