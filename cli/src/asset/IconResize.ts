import type { IconPixels } from "./PngIcon.ts"

const lanczosSupport = 3
const transparentThreshold = 1e-7
const linearColors = Float64Array.from({ length: 256 }, (_, value) => {
    const component = value / 255
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4
})

interface FilterTaps {
    readonly first: number
    readonly weights: Float64Array
}

function lanczos(value: number): number {
    if (Math.abs(value) < transparentThreshold) return 1
    if (Math.abs(value) >= lanczosSupport) return 0
    const angle = Math.PI * value
    return Math.sin(angle) / angle * Math.sin(angle / lanczosSupport) / (angle / lanczosSupport)
}

function makeFilters(sourceSize: number, targetSize: number): FilterTaps[] {
    const ratio = sourceSize / targetSize
    // 缩小时扩大采样支撑范围，过滤高频纹理而不是只取邻近像素
    const support = lanczosSupport * ratio
    return Array.from({ length: targetSize }, (_, position) => {
        const center = (position + 0.5) * ratio - 0.5
        const first = Math.max(0, Math.ceil(center - support))
        const last = Math.min(sourceSize - 1, Math.floor(center + support))
        const weights = Float64Array.from({ length: last - first + 1 }, (_, index) => lanczos((first + index - center) / ratio))
        const sum = weights.reduce((total, value) => total + value, 0)
        for (let index = 0; index < weights.length; index++) weights[index] /= sum
        return { first, weights }
    })
}

function linearByte(value: number): number {
    const bounded = Math.min(1, Math.max(0, value))
    const component = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055
    return Math.round(component * 255)
}

export function resizeIcon(source: IconPixels, targetSize: number, signal?: AbortSignal): IconPixels {
    if (!Number.isInteger(targetSize) || targetSize < 1 || targetSize > source.size) throw new Error("图标缩放目标必须是有效尺寸，且不得大于源图")
    if (source.data.length !== source.size * source.size * 4) throw new Error("图标 RGBA 像素数据不完整")
    signal?.throwIfAborted()
    if (targetSize === source.size) return { size: targetSize, data: Buffer.from(source.data) }
    const filters = makeFilters(source.size, targetSize)
    // 在线性光空间累积预乘 alpha 的颜色，透明像素的隐藏颜色不参与混合
    const horizontal = new Float32Array(source.size * targetSize * 4)
    for (let row = 0; row < source.size; row++) {
        signal?.throwIfAborted()
        for (let column = 0; column < targetSize; column++) {
            const filter = filters[column]
            const destination = (row * targetSize + column) * 4
            for (let index = 0; index < filter.weights.length; index++) {
                const origin = (row * source.size + filter.first + index) * 4
                const alpha = source.data[origin + 3] / 255
                const weight = filter.weights[index]
                for (let channel = 0; channel < 3; channel++) horizontal[destination + channel] += linearColors[source.data[origin + channel]] * alpha * weight
                horizontal[destination + 3] += alpha * weight
            }
        }
    }
    const data = Buffer.alloc(targetSize * targetSize * 4)
    for (let row = 0; row < targetSize; row++) {
        signal?.throwIfAborted()
        const filter = filters[row]
        for (let column = 0; column < targetSize; column++) {
            const pixel = [0, 0, 0, 0]
            for (let index = 0; index < filter.weights.length; index++) {
                const origin = ((filter.first + index) * targetSize + column) * 4
                for (let channel = 0; channel < 4; channel++) pixel[channel] += horizontal[origin + channel] * filter.weights[index]
            }
            const destination = (row * targetSize + column) * 4
            if (pixel[3] <= transparentThreshold) continue
            for (let channel = 0; channel < 3; channel++) data[destination + channel] = linearByte(pixel[channel] / pixel[3])
            data[destination + 3] = Math.round(Math.min(1, pixel[3]) * 255)
        }
    }
    return { size: targetSize, data }
}
