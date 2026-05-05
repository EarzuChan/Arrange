include(FetchContent)

set(ARRANGE_JUCE_GIT_REPOSITORY "https://github.com/juce-framework/JUCE.git" CACHE STRING "JUCE git repository")
set(ARRANGE_JUCE_GIT_TAG "8.0.12" CACHE STRING "Pinned JUCE release tag")
set(ARRANGE_QUICKJS_NG_GIT_REPOSITORY "https://github.com/quickjs-ng/quickjs.git" CACHE STRING "QuickJS-NG git repository")
set(ARRANGE_QUICKJS_NG_GIT_TAG "v0.14.0" CACHE STRING "Pinned QuickJS-NG release tag")

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
endfunction()

function(arrange_fetch_quickjs_ng)
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
endfunction()
