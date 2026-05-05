cmake_minimum_required(VERSION 3.24)
project(Arrange LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(cmake/Dependencies.cmake)

option(ARRANGE_WITH_QUICKJS_NG "Fetch and link QuickJS-NG dependency" OFF)
if(ARRANGE_WITH_QUICKJS_NG)
  arrange_fetch_quickjs_ng()
endif()

option(ARRANGE_BUILD_DEMO "Build Arrange JUCE demo plugin" OFF)
if(ARRANGE_BUILD_DEMO)
  arrange_fetch_juce()
endif()

add_subdirectory(native/arrange_core)
add_subdirectory(native/arrange_quickjs)
add_subdirectory(native/arrange_juce)

if(ARRANGE_BUILD_DEMO)
  add_subdirectory(demo/plugin-src)
endif()

option(ARRANGE_BUILD_TESTS "Build Arrange C++ tests" ON)
if(ARRANGE_BUILD_TESTS)
  enable_testing()
  add_subdirectory(cpp_tests)
endif()
