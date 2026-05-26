cmake_minimum_required(VERSION 3.24)
include(cmake/ArrangeVersion.cmake)
project(Arrange VERSION "${ARRANGE_NUMERIC_VERSION}" LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(cmake/Dependencies.cmake)

if(CMAKE_SOURCE_DIR STREQUAL PROJECT_SOURCE_DIR)
  set(ARRANGE_IS_TOP_LEVEL ON)
else()
  set(ARRANGE_IS_TOP_LEVEL OFF)
endif()

arrange_fetch_quickjs_ng()
arrange_fetch_juce()

add_subdirectory(native/arrange_core)
add_subdirectory(native/arrange_quickjs)
add_subdirectory(native/arrange_juce)

add_library(arrange_framework INTERFACE)
add_library(Arrange::framework ALIAS arrange_framework)
target_link_libraries(arrange_framework INTERFACE Arrange::juce)

option(ARRANGE_BUILD_TESTS "Build Arrange C++ tests" ${ARRANGE_IS_TOP_LEVEL})
if(ARRANGE_BUILD_TESTS)
  enable_testing()
  add_subdirectory(cpp_tests)
endif()
