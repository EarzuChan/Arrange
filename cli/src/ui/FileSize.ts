const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"] as const
const unitBase = 1000

// 采用十进制单位，最多一位小数；舍入达到下一单位时继续进位
export function formatFileSize(bytes: number): string {
    let value = bytes
    let unit = 0
    while (Math.round(value * 10) / 10 >= unitBase && unit < units.length - 1) {
        value /= unitBase
        unit++
    }
    return `${Number(value.toFixed(unit === 0 ? 0 : 1))} ${units[unit]}`
}
