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

// 单位形状由修饰 schema 与值契约共用
export const unitShapes = { shape, brush, style, offset, size, range, sizeRange, padding, graphics } as const

export const unitFieldContracts: Readonly<Record<string, UnitFields>> = {
    style, shape, brush, padding, offset, size, rect: { ...offset, ...size }, range, sizeRange, graphics,
    border: { width: 'length', brush, shape },
    text: { style },
    textField: { textStyle: style },
    paint: { colorFilter: { tint: 'color' } },
    arrangement: { space: 'length' },
    row: { horizontalArrangement: { space: 'length' } },
    column: { verticalArrangement: { space: 'length' } },
    flow: { horizontalArrangement: { space: 'length' }, verticalArrangement: { space: 'length' } },
    scroll: { valuePx: 'px', maxValuePx: 'px', viewportSizePx: 'px', contentSizePx: 'px' },
    scrollOptions: { initialPx: 'px' },
    pxSize: { width: 'px', height: 'px' },
    drawRect: { x: 'px', y: 'px', width: 'px', height: 'px' },
    drawPaint: { color: 'color', strokeWidth: 'px' },
    drawRoundRect: { x: 'px', y: 'px', width: 'px', height: 'px', radius: 'px', color: 'color', strokeWidth: 'px' },
    drawCircle: { centerX: 'px', centerY: 'px', radius: 'px', color: 'color', strokeWidth: 'px' },
    drawLine: { startX: 'px', startY: 'px', endX: 'px', endY: 'px', color: 'color', strokeWidth: 'px' },
    dpOffset: { x: 'dp', y: 'dp' },
    dpSize: { width: 'dp', height: 'dp' },
    dpRect: { x: 'dp', y: 'dp', width: 'dp', height: 'dp' },
}
