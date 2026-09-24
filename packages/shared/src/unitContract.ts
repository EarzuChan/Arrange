export type ValueUnit = 'dp' | 'sp' | 'px' | 'color' | 'length'
export type UnitFields = Readonly<{ [name: string]: ValueUnit | UnitFields }>

const shape: UnitFields = { radius: 'length' }
const brush: UnitFields = { color: 'color' }
const style: UnitFields = { fontSize: 'sp', lineHeight: 'sp', color: 'color' }
const offset: UnitFields = { x: 'length', y: 'length' }
const size: UnitFields = { width: 'length', height: 'length' }
const range: UnitFields = { min: 'length', max: 'length' }
const sizeRange: UnitFields = { minWidth: 'length', maxWidth: 'length', minHeight: 'length', maxHeight: 'length' }
const padding: UnitFields = { start: 'length', top: 'length', end: 'length', bottom: 'length', horizontal: 'length', vertical: 'length' }
const graphics: UnitFields = { translationX: 'px', translationY: 'px' }

// 描述字段的单位由这份契约定义，编译器和前端解析共同消费
export const modifierUnitFields: Readonly<Record<string, UnitFields>> = {
    width: { value: 'length' }, height: { value: 'length' }, size,
    requiredWidth: { width: 'length' }, requiredHeight: { height: 'length' }, requiredSize: size,
    widthIn: range, heightIn: range, sizeIn: sizeRange, defaultMinSize: sizeRange,
    padding, offset, absoluteOffset: offset,
    background: { brush, shape }, border: { width: 'length', brush, shape }, clip: { shape },
    text: { style }, textField: { textStyle: style },
    graphicsLayer: graphics, paint: { colorFilter: { tint: 'color' } },
}

// 调用参数与描述字段之间的映射，不按业务变量名猜单位
export const modifierArgumentUnits: Readonly<Record<string, readonly (ValueUnit | UnitFields | undefined)[]>> = {
    width: ['length'], height: ['length'], size: ['length', 'length'], requiredWidth: ['length'], requiredHeight: ['length'], requiredSize: ['length', 'length'],
    widthIn: [range], heightIn: [range], sizeIn: [sizeRange], defaultMinSize: [sizeRange],
    padding: [padding], offset: [offset], absoluteOffset: [offset],
    background: [brush, shape], border: ['length', brush, shape], clip: [shape],
    text: [undefined, { style }], textField: [undefined, { textStyle: style }],
    graphicsLayer: [graphics], paint: [undefined, modifierUnitFields.paint],
}

export const unitFieldContracts: Readonly<Record<string, UnitFields>> = {
    style, shape, brush, padding, offset, size, rect: { ...offset, ...size }, range, sizeRange, graphics,
    border: modifierUnitFields.border,
    text: modifierUnitFields.text,
    textField: modifierUnitFields.textField,
    paint: modifierUnitFields.paint,
    arrangement: { space: 'length' },
    row: { horizontalArrangement: { space: 'length' } },
    column: { verticalArrangement: { space: 'length' } },
    scroll: { value: 'px', maxValue: 'px', viewportSize: 'px', contentSize: 'px' },
    scrollOptions: { initial: 'px' },
    pxSize: { width: 'px', height: 'px' },
}
