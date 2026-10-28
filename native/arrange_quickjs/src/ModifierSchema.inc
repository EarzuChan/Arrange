// 由 scripts/modifier-schema.ts 依 @arrange/shared 修饰 schema 生成，勿手改

inline constexpr std::string_view textFields[]{"text", "style", "singleLine", "minLines", "maxLines", "textAlign", "overflow"};
inline constexpr std::string_view textFieldFields[]{"value", "textStyle", "singleLine", "minLines", "maxLines", "placeholder", "enabled", "selectAllOnFocus", "onValueChange", "onSubmit", "onChange", "onBlur"};
inline constexpr ModifierCallbackField textFieldCallbacks[]{{"onValueChange", arrange::core::EventSlotKind::InputUpdate}, {"onSubmit", arrange::core::EventSlotKind::InputSubmit}, {"onChange", arrange::core::EventSlotKind::InputChange}, {"onBlur", arrange::core::EventSlotKind::InputBlur}};
inline constexpr std::string_view paintFields[]{"painter", "contentScale", "alignment", "alpha", "colorFilter", "sizeToIntrinsics"};
inline constexpr std::string_view paddingFields[]{"start", "top", "end", "bottom"};
inline constexpr std::string_view widthFields[]{"value"};
inline constexpr std::string_view heightFields[]{"value"};
inline constexpr std::string_view alphaFields[]{"value"};
inline constexpr std::string_view zIndexFields[]{"value"};
inline constexpr std::string_view intrinsicWidthFields[]{"maximum"};
inline constexpr std::string_view intrinsicHeightFields[]{"maximum"};
inline constexpr std::string_view requiredWidthFields[]{"width"};
inline constexpr std::string_view requiredHeightFields[]{"height"};
inline constexpr std::string_view sizeFields[]{"width", "height"};
inline constexpr std::string_view requiredSizeFields[]{"width", "height"};
inline constexpr std::string_view fillMaxWidthFields[]{"fraction"};
inline constexpr std::string_view fillMaxHeightFields[]{"fraction"};
inline constexpr std::string_view fillMaxSizeFields[]{"fraction"};
inline constexpr std::string_view widthInFields[]{"min", "max"};
inline constexpr std::string_view heightInFields[]{"min", "max"};
inline constexpr std::string_view sizeInFields[]{"minWidth", "maxWidth", "minHeight", "maxHeight"};
inline constexpr std::string_view defaultMinSizeFields[]{"minWidth", "minHeight"};
inline constexpr std::string_view verticalScrollFields[]{"value", "onScroll", "enabled"};
inline constexpr ModifierCallbackField verticalScrollCallbacks[]{{"onScroll", arrange::core::EventSlotKind::VerticalScroll}};
inline constexpr std::string_view horizontalScrollFields[]{"value", "onScroll", "enabled"};
inline constexpr ModifierCallbackField horizontalScrollCallbacks[]{{"onScroll", arrange::core::EventSlotKind::HorizontalScroll}};
inline constexpr std::string_view animateContentSizeFields[]{"animationSpec", "clip"};
inline constexpr std::string_view weightFields[]{"weight", "fill"};
inline constexpr std::string_view alignFields[]{"alignment"};
inline constexpr std::string_view offsetFields[]{"x", "y"};
inline constexpr std::string_view absoluteOffsetFields[]{"x", "y"};
inline constexpr std::string_view graphicsLayerFields[]{"translationX", "translationY", "scaleX", "scaleY", "rotationZ", "transformOrigin", "alpha", "clip"};
inline constexpr std::string_view drawBehindFields[]{"prepare", "revision", "transactional"};
inline constexpr ModifierCallbackField drawBehindCallbacks[]{{"prepare", arrange::core::EventSlotKind::DrawPrepare}};
inline constexpr std::string_view drawWithContentFields[]{"prepare", "revision", "transactional"};
inline constexpr ModifierCallbackField drawWithContentCallbacks[]{{"prepare", arrange::core::EventSlotKind::DrawPrepare}};
inline constexpr std::string_view drawWithCacheFields[]{"prepare", "revision", "transactional"};
inline constexpr ModifierCallbackField drawWithCacheCallbacks[]{{"prepare", arrange::core::EventSlotKind::DrawPrepare}};
inline constexpr std::string_view backgroundFields[]{"color", "brush", "shape"};
inline constexpr std::string_view borderFields[]{"width", "color", "brush", "shape"};
inline constexpr std::string_view clipFields[]{"shape"};
inline constexpr std::string_view clickableFields[]{"enabled", "focusable", "onClick", "onDoubleClick", "interaction"};
inline constexpr ModifierCallbackField clickableCallbacks[]{{"onClick", arrange::core::EventSlotKind::Click}, {"onDoubleClick", arrange::core::EventSlotKind::DoubleClick}, {"interaction", arrange::core::EventSlotKind::Interaction}};
inline constexpr std::string_view hoverableFields[]{"enabled", "onEnter", "onExit", "interaction"};
inline constexpr ModifierCallbackField hoverableCallbacks[]{{"onEnter", arrange::core::EventSlotKind::HoverEnter}, {"onExit", arrange::core::EventSlotKind::HoverExit}, {"interaction", arrange::core::EventSlotKind::Interaction}};
inline constexpr std::string_view focusableFields[]{"enabled", "interaction"};
inline constexpr ModifierCallbackField focusableCallbacks[]{{"interaction", arrange::core::EventSlotKind::Interaction}};
inline constexpr std::string_view onContextClickFields[]{"enabled", "callback"};
inline constexpr ModifierCallbackField onContextClickCallbacks[]{{"callback", arrange::core::EventSlotKind::ContextClick}};
inline constexpr std::string_view onWheelFields[]{"enabled", "axis", "callback"};
inline constexpr ModifierCallbackField onWheelCallbacks[]{{"callback", arrange::core::EventSlotKind::Wheel}};
inline constexpr std::string_view onKeyEventFields[]{"callback"};
inline constexpr ModifierCallbackField onKeyEventCallbacks[]{{"callback", arrange::core::EventSlotKind::Key}};
inline constexpr std::string_view pointerInputFields[]{"enabled", "callback"};
inline constexpr ModifierCallbackField pointerInputCallbacks[]{{"callback", arrange::core::EventSlotKind::PointerInput}};
inline constexpr std::string_view pointerIconFields[]{"icon"};
inline constexpr std::string_view draggableFields[]{"enabled", "axis", "startImmediately", "pointerLock", "onDelta", "onStart", "onStop", "interaction"};
inline constexpr ModifierCallbackField draggableCallbacks[]{{"onDelta", arrange::core::EventSlotKind::DragDelta}, {"onStart", arrange::core::EventSlotKind::DragStart}, {"onStop", arrange::core::EventSlotKind::DragStop}, {"interaction", arrange::core::EventSlotKind::Interaction}};
inline constexpr std::string_view focusRequesterFields[]{"requester"};
inline constexpr std::string_view semanticsFields[]{"role", "label", "description", "valueText", "enabled", "increment", "decrement"};
inline constexpr ModifierCallbackField semanticsCallbacks[]{{"increment", arrange::core::EventSlotKind::SemanticsIncrement}, {"decrement", arrange::core::EventSlotKind::SemanticsDecrement}};
inline constexpr std::string_view onFocusChangedFields[]{"callback"};
inline constexpr ModifierCallbackField onFocusChangedCallbacks[]{{"callback", arrange::core::EventSlotKind::FocusChanged}};
inline constexpr std::string_view focusPropertiesFields[]{"canFocus", "next", "previous", "up", "down", "left", "right"};

inline constexpr ModifierSchemaEntry modifierSchemaEntries[]{
    {"text", textFields, {}},
    {"textField", textFieldFields, textFieldCallbacks},
    {"paint", paintFields, {}},
    {"padding", paddingFields, {}},
    {"width", widthFields, {}},
    {"height", heightFields, {}},
    {"alpha", alphaFields, {}},
    {"zIndex", zIndexFields, {}},
    {"intrinsicWidth", intrinsicWidthFields, {}},
    {"intrinsicHeight", intrinsicHeightFields, {}},
    {"requiredWidth", requiredWidthFields, {}},
    {"requiredHeight", requiredHeightFields, {}},
    {"size", sizeFields, {}},
    {"requiredSize", requiredSizeFields, {}},
    {"fillMaxWidth", fillMaxWidthFields, {}},
    {"fillMaxHeight", fillMaxHeightFields, {}},
    {"fillMaxSize", fillMaxSizeFields, {}},
    {"widthIn", widthInFields, {}},
    {"heightIn", heightInFields, {}},
    {"sizeIn", sizeInFields, {}},
    {"defaultMinSize", defaultMinSizeFields, {}},
    {"verticalScroll", verticalScrollFields, verticalScrollCallbacks},
    {"horizontalScroll", horizontalScrollFields, horizontalScrollCallbacks},
    {"animateContentSize", animateContentSizeFields, {}},
    {"weight", weightFields, {}},
    {"align", alignFields, {}},
    {"matchParentSize", {}, {}},
    {"offset", offsetFields, {}},
    {"absoluteOffset", absoluteOffsetFields, {}},
    {"graphicsLayer", graphicsLayerFields, {}},
    {"drawBehind", drawBehindFields, drawBehindCallbacks},
    {"drawWithContent", drawWithContentFields, drawWithContentCallbacks},
    {"drawWithCache", drawWithCacheFields, drawWithCacheCallbacks},
    {"background", backgroundFields, {}},
    {"border", borderFields, {}},
    {"clip", clipFields, {}},
    {"clickable", clickableFields, clickableCallbacks},
    {"hoverable", hoverableFields, hoverableCallbacks},
    {"focusable", focusableFields, focusableCallbacks},
    {"onContextClick", onContextClickFields, onContextClickCallbacks},
    {"onWheel", onWheelFields, onWheelCallbacks},
    {"onKeyEvent", onKeyEventFields, onKeyEventCallbacks},
    {"pointerInput", pointerInputFields, pointerInputCallbacks},
    {"pointerIcon", pointerIconFields, {}},
    {"draggable", draggableFields, draggableCallbacks},
    {"focusRequester", focusRequesterFields, {}},
    {"semantics", semanticsFields, semanticsCallbacks},
    {"focusGroup", {}, {}},
    {"onFocusChanged", onFocusChangedFields, onFocusChangedCallbacks},
    {"focusProperties", focusPropertiesFields, {}},
};
