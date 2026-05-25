add_library(arrange_core STATIC
  src/Version.cpp
  src/EventSlot.cpp
  src/PropValue.cpp
  src/PropSchema.cpp
  src/TextLayoutService.cpp
  src/InputIntent.cpp
  src/Invalidation.cpp
  src/Mutation.cpp
  src/MutationTransaction.cpp
  src/NativeScene.cpp
  src/LayoutTree.cpp
  src/SceneFramePipeline.cpp
  src/Modifier.cpp
  src/Layout.cpp
  src/HitTest.cpp
  src/PointerInputProcessor.cpp
  src/Scroll.cpp
  src/InputEditing.cpp
  src/Paint.cpp
)
add_library(Arrange::core ALIAS arrange_core)
target_include_directories(arrange_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_compile_features(arrange_core PUBLIC cxx_std_20)
