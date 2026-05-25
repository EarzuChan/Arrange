file(READ "${CMAKE_CURRENT_LIST_DIR}/../arrange.version.json" _arrange_version_json)
string(JSON ARRANGE_VERSION GET "${_arrange_version_json}" version)
string(JSON ARRANGE_PROTOCOL_VERSION GET "${_arrange_version_json}" protocolVersion)

if(NOT ARRANGE_VERSION MATCHES "^0\\.0\\.0-m\\.[0-9]+\\.[0-9]+$")
  message(FATAL_ERROR "Arrange version must use 0.0.0-m.<N>.<sub>, got '${ARRANGE_VERSION}'")
endif()

string(REGEX MATCH "^[0-9]+\\.[0-9]+\\.[0-9]+" ARRANGE_NUMERIC_VERSION "${ARRANGE_VERSION}")
if(NOT ARRANGE_NUMERIC_VERSION)
  message(FATAL_ERROR "Arrange version '${ARRANGE_VERSION}' has no numeric SemVer core")
endif()
