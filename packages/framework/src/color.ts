// 颜色构造及动画入口共享校验，绘制事务仍由 native 边界独立验证
export function requireArgb(value: number): number {
    if (!Number.isFinite(value)) throw new TypeError('Color 的 ARGB 数值必须是有限数值')
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('Color 的 ARGB 数值必须是 uint32 整数')
    return value
}
