if(NOT DEFINED ARRANGE_DEMO_UI_DIST_DIR OR ARRANGE_DEMO_UI_DIST_DIR STREQUAL "")
  message(FATAL_ERROR "ARRANGE_DEMO_UI_DIST_DIR is required")
endif()

if(NOT DEFINED ARRANGE_DEMO_TARGET_FILE_DIR OR ARRANGE_DEMO_TARGET_FILE_DIR STREQUAL "")
  message(FATAL_ERROR "ARRANGE_DEMO_TARGET_FILE_DIR is required")
endif()

set(source_dir "${ARRANGE_DEMO_UI_DIST_DIR}")
set(target_file_dir "${ARRANGE_DEMO_TARGET_FILE_DIR}")

if(NOT IS_DIRECTORY "${source_dir}")
  message(FATAL_ERROR "Arrange demo UI dist directory does not exist: ${source_dir}")
endif()

if(target_file_dir MATCHES [[(^|[\\/])Contents([\\/]|$)]])
  set(dest_dir "${target_file_dir}/../Resources/ui")
else()
  set(dest_dir "${target_file_dir}/ui")
endif()

file(REMOVE_RECURSE "${dest_dir}")
file(MAKE_DIRECTORY "${dest_dir}")
file(COPY "${source_dir}/" DESTINATION "${dest_dir}")
