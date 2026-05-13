add_library(arrange_core STATIC
  src/Version.cpp
  src/EventSlot.cpp
  src/PropValue.cpp
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
target_include_directories(arrange_core PUBLIC include)


