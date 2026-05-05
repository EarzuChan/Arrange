add_library(arrange_core STATIC
  src/Version.cpp
  src/PropValue.cpp
  src/TextLayoutService.cpp
  src/Bridge.cpp
  src/RenderTree.cpp
  src/Modifier.cpp
  src/Layout.cpp
  src/HitTest.cpp
  src/PointerDispatcher.cpp
  src/Scroll.cpp
  src/InputEditing.cpp
  src/Paint.cpp
)
target_include_directories(arrange_core PUBLIC include)
