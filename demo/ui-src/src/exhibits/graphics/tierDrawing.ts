import { Path, type DrawScope } from '@arrange/framework/ui'

// 色相 0..360，饱和度与亮度 0..1，返回不透明 ARGB
function hsl(hue: number, saturation: number, lightness: number): number {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const channel = (offset: number) => {
        const k = (offset + hue / 30) % 12
        return Math.round((lightness - chroma / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
    }
    return (0xff000000 | channel(0) << 16 | channel(8) << 8 | channel(4)) >>> 0
}

// 三档共用的绘制：A、B 档在 JS 里画同一套图形，C 档由同名原生 painter 画
export function drawMeter(scope: DrawScope, level: number): void {
    const decibels = 20 * Math.log10(Math.max(level, 1e-4))
    const fill = Math.min(1, Math.max(0, (decibels + 60) / 60))
    scope.drawRect({ color: 0xffe5e5ea })
    scope.drawRect({ width: scope.size.width * fill, color: decibels > -3 ? 0xffff3b30 : 0xff007aff })
}

export function drawWaveform(scope: DrawScope, samples: ArrayLike<number>): void {
    const { width, height } = scope.size
    scope.drawRect({ color: 0xfff2f2f7 })
    scope.drawLine({ startX: 0, startY: height / 2, endX: width, endY: height / 2, color: 0xffd1d1d6, strokeWidth: 1 })
    if (samples.length < 2) return
    const path = new Path()
    for (let i = 0; i < samples.length; i++) {
        const x = i / (samples.length - 1) * width
        const y = height / 2 * (1 - Math.min(1, Math.max(-1, samples[i])))
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
    }
    scope.drawPath(path, { color: 0xff007aff, strokeWidth: 1.5, join: 'round' })
}

export function drawSpectrum(scope: DrawScope, bins: ArrayLike<number>): void {
    const { width, height } = scope.size
    scope.drawRect({ color: 0xfff2f2f7 })
    if (!bins.length) return
    const step = width / bins.length
    for (let i = 0; i < bins.length; i++) {
        const barHeight = Math.max(1, bins[i] * height)
        scope.drawRect({ x: i * step + 1, y: height - barHeight, width: Math.max(1, step - 2), height: barHeight, color: hsl(200 - bins[i] * 160, 0.7, 0.55) })
    }
}
