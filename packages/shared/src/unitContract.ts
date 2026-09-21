export type ValueUnit = 'dp' | 'sp' | 'px' | 'color'
export type UnitFields = Readonly<{ [name: string]: ValueUnit | UnitFields }>

const shape: UnitFields = { radius: 'dp' }
const brush: UnitFields = { color: 'color' }
const style: UnitFields = { fontSize: 'sp', lineHeight: 'sp', color: 'color' }
const offset: UnitFields = { x: 'dp', y: 'dp' }
const size: UnitFields = { width: 'dp', height: 'dp' }
const range: UnitFields = { min: 'dp', max: 'dp' }
const sizeRange: UnitFields = { minWidth: 'dp', maxWidth: 'dp', minHeight: 'dp', maxHeight: 'dp' }
const padding: UnitFields = { start: 'dp', top: 'dp', end: 'dp', bottom: 'dp', horizontal: 'dp', vertical: 'dp' }
const graphics: UnitFields = { translationX: 'px', translationY: 'px' }

// 描述字段的单位由这份契约定义，编译器和前端解析共同消费
export const modifierUnitFields: Readonly<Record<string, UnitFields>> = {
    width: { value: 'dp' }, height: { value: 'dp' }, size,
    requiredWidth: { width: 'dp' }, requiredHeight: { height: 'dp' }, requiredSize: size,
    widthIn: range, heightIn: range, sizeIn: sizeRange, defaultMinSize: sizeRange,
    padding, offset, absoluteOffset: offset,
    background: { brush, shape }, border: { width: 'dp', brush, shape }, clip: { shape },
    text: { style }, textField: { textStyle: style },
    graphicsLayer: graphics, paint: { colorFilter: { tint: 'color' } },
}

// 调用参数与描述字段之间的映射，不按业务变量名猜单位
export const modifierArgumentUnits: Readonly<Record<string, readonly (ValueUnit | UnitFields | undefined)[]>> = {
    width: ['dp'], height: ['dp'], size: ['dp', 'dp'], requiredWidth: ['dp'], requiredHeight: ['dp'], requiredSize: ['dp', 'dp'],
    widthIn: [range], heightIn: [range], sizeIn: [sizeRange], defaultMinSize: [sizeRange],
    padding: [padding], offset: [offset], absoluteOffset: [offset],
    background: [brush, shape], border: ['dp', brush, shape], clip: [shape],
    text: [undefined, { style }], textField: [undefined, { textStyle: style }],
    graphicsLayer: [graphics], paint: [undefined, modifierUnitFields.paint],
}

export const unitFieldContracts: Readonly<Record<string, UnitFields>> = {
    style, shape, brush, padding, offset, size, rect: { ...offset, ...size }, range, sizeRange, graphics,
    border: modifierUnitFields.border,
    text: modifierUnitFields.text,
    textField: modifierUnitFields.textField,
    paint: modifierUnitFields.paint,
    arrangement: { space: 'dp' },
    row: { horizontalArrangement: { space: 'dp' } },
    column: { verticalArrangement: { space: 'dp' } },
    scroll: { value: 'px', maxValue: 'px', viewportSize: 'px', contentSize: 'px' },
    scrollOptions: { initial: 'px' },
    pxSize: { width: 'px', height: 'px' },
}
