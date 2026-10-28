add_library(arrange_core STATIC
  src/Version.cpp
  src/EventSlot.cpp
  src/PropValue.cpp
  src/PropSchema.cpp
  src/TextLayoutService.cpp
  src/Mutation.cpp
  src/MutationTransaction.cpp
  src/HostInput.cpp
  src/SlotUpdate.cpp
  src/NativeScene.cpp
  src/LayoutTree.cpp
  src/SceneFramePipeline.cpp
  src/Modifier.cpp
  src/ModifierGeometry.cpp
  src/IntrinsicLayout.cpp
  src/FlowLayout.cpp
  src/LazyLayout.cpp
  src/Focus.cpp
  src/FocusOwner.cpp
  src/InputSession.cpp
  src/Layout.cpp
  src/MeasurePolicy.cpp
  src/HitTest.cpp
  src/PointerGesture.cpp
  src/PointerInputState.cpp
  src/Scroll.cpp
  src/InputEditing.cpp
  src/Paint.cpp
  src/Repaint.cpp
  src/Interop.cpp
)
add_library(Arrange::core ALIAS arrange_core)
target_include_directories(arrange_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_compile_features(arrange_core PUBLIC cxx_std_20)
