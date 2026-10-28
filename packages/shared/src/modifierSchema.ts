import { unitShapes, type UnitFields, type ValueUnit } from './unitContract.ts'

// 原生事件种类名，与 C++ EventSlotKind 的枚举名首字母小写一致
export type ModifierEventKind = | 'click' | 'doubleClick' | 'contextClick' | 'hoverEnter' | 'hoverExit' | 'interaction' | 'key' | 'wheel' | 'pointerInput' | 'dragStart' | 'dragDelta' | 'dragStop' | 'verticalScroll' | 'horizontalScroll' | 'inputUpdate' | 'inputSubmit' | 'inputChange' | 'inputBlur' | 'drawPrepare' | 'focusChanged' | 'semanticsIncrement' | 'semanticsDecrement'

export interface ModifierSchemaEntry {
    // 交给原生的描述字段，原生只接受这些字段
    readonly fields: readonly string[]
    // 描述字段的单位
    readonly units?: UnitFields
    // 调用参数与描述字段之间的单位映射，不按业务变量名猜单位
    readonly arguments?: readonly (ValueUnit | UnitFields | undefined)[]
    // 回调字段及其原生事件种类
    readonly events?: Readonly<Record<string, ModifierEventKind>>
}

const { shape, brush, style, offset, size, range, sizeRange, padding, graphics } = unitShapes
const length = (name: string) => ({ fields: [name], units: { [name]: 'length' }, arguments: ['length'] }) as const
const colorFilter: UnitFields = { colorFilter: { tint: 'color' } }
const scroll = (kind: ModifierEventKind) => ({ fields: ['value', 'onScroll', 'enabled'], events: { onScroll: kind } }) as const
const draw: ModifierSchemaEntry = { fields: ['prepare', 'revision', 'transactional'], events: { prepare: 'drawPrepare' } }

// 修饰表的唯一事实源：JS 降解、编译器单位检查与原生字段白名单都由它驱动
export const modifierSchema: Readonly<Record<string, ModifierSchemaEntry>> = {
    text: { fields: ['text', 'style', 'singleLine', 'minLines', 'maxLines', 'textAlign', 'overflow'], units: { style }, arguments: [undefined, { style }] },
    textField: {
        fields: ['value', 'textStyle', 'singleLine', 'minLines', 'maxLines', 'placeholder', 'enabled', 'selectAllOnFocus', 'onValueChange', 'onSubmit', 'onChange', 'onBlur'],
        units: { textStyle: style }, arguments: [undefined, { textStyle: style }],
        events: { onValueChange: 'inputUpdate', onSubmit: 'inputSubmit', onChange: 'inputChange', onBlur: 'inputBlur' },
    },
    paint: { fields: ['painter', 'contentScale', 'alignment', 'alpha', 'colorFilter', 'sizeToIntrinsics'], units: colorFilter, arguments: [undefined, colorFilter] },
    padding: { fields: ['start', 'top', 'end', 'bottom'], units: padding, arguments: [padding] },
    width: length('value'), height: length('value'),
    alpha: { fields: ['value'] }, zIndex: { fields: ['value'] },
    intrinsicWidth: { fields: ['maximum'] }, intrinsicHeight: { fields: ['maximum'] },
    requiredWidth: length('width'), requiredHeight: length('height'),
    size: { fields: ['width', 'height'], units: size, arguments: ['length', 'length'] },
    requiredSize: { fields: ['width', 'height'], units: size, arguments: ['length', 'length'] },
    fillMaxWidth: { fields: ['fraction'] }, fillMaxHeight: { fields: ['fraction'] }, fillMaxSize: { fields: ['fraction'] },
    widthIn: { fields: ['min', 'max'], units: range, arguments: [range] },
    heightIn: { fields: ['min', 'max'], units: range, arguments: [range] },
    sizeIn: { fields: ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'], units: sizeRange, arguments: [sizeRange] },
    defaultMinSize: { fields: ['minWidth', 'minHeight'], units: sizeRange, arguments: [sizeRange] },
    verticalScroll: scroll('verticalScroll'), horizontalScroll: scroll('horizontalScroll'),
    animateContentSize: { fields: ['animationSpec', 'clip'] },
    weight: { fields: ['weight', 'fill'] },
    align: { fields: ['alignment'] },
    matchParentSize: { fields: [] },
    offset: { fields: ['x', 'y'], units: offset, arguments: [offset] },
    absoluteOffset: { fields: ['x', 'y'], units: offset, arguments: [offset] },
    graphicsLayer: { fields: ['translationX', 'translationY', 'scaleX', 'scaleY', 'rotationZ', 'transformOrigin', 'alpha', 'clip'], units: graphics, arguments: [graphics] },
    drawBehind: draw, drawWithContent: draw, drawWithCache: draw,
    background: { fields: ['color', 'brush', 'shape'], units: { brush, shape }, arguments: [brush, shape] },
    border: { fields: ['width', 'color', 'brush', 'shape'], units: { width: 'length', brush, shape }, arguments: ['length', brush, shape] },
    clip: { fields: ['shape'], units: { shape }, arguments: [shape] },
    clickable: { fields: ['enabled', 'focusable', 'onClick', 'onDoubleClick', 'interaction'], events: { onClick: 'click', onDoubleClick: 'doubleClick', interaction: 'interaction' } },
    hoverable: { fields: ['enabled', 'onEnter', 'onExit', 'interaction'], events: { onEnter: 'hoverEnter', onExit: 'hoverExit', interaction: 'interaction' } },
    focusable: { fields: ['enabled', 'interaction'], events: { interaction: 'interaction' } },
    onContextClick: { fields: ['enabled', 'callback'], events: { callback: 'contextClick' } },
    onWheel: { fields: ['enabled', 'axis', 'callback'], events: { callback: 'wheel' } },
    onKeyEvent: { fields: ['callback'], events: { callback: 'key' } },
    pointerInput: { fields: ['enabled', 'callback'], events: { callback: 'pointerInput' } },
    pointerIcon: { fields: ['icon'] },
    draggable: {
        fields: ['enabled', 'axis', 'startImmediately', 'pointerLock', 'onDelta', 'onStart', 'onStop', 'interaction'],
        events: { onDelta: 'dragDelta', onStart: 'dragStart', onStop: 'dragStop', interaction: 'interaction' },
    },
    focusRequester: { fields: ['requester'] },
    semantics: { fields: ['role', 'label', 'description', 'valueText', 'enabled', 'increment', 'decrement'], events: { increment: 'semanticsIncrement', decrement: 'semanticsDecrement' } },
    focusGroup: { fields: [] },
    onFocusChanged: { fields: ['callback'], events: { callback: 'focusChanged' } },
    focusProperties: { fields: ['canFocus', 'next', 'previous', 'up', 'down', 'left', 'right'] },
}

function pick<T>(select: (entry: ModifierSchemaEntry) => T | undefined): Readonly<Record<string, T>> {
    const result: Record<string, T> = {}
    for (const [name, entry] of Object.entries(modifierSchema)) {
        const value = select(entry)
        if (value !== undefined) result[name] = value
    }
    return Object.freeze(result)
}

export const modifierUnitFields = pick(entry => entry.units)
export const modifierArgumentUnits = pick(entry => entry.arguments)
