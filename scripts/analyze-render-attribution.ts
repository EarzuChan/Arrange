import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve(process.argv[2] ?? 'build/render-attribution-cache')
const parse = (path: string) => {
    const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
    const keys = header.split(',')
    return lines.filter(Boolean).map(line => Object.fromEntries(line.split(',').map((value, index) => [keys[index], value])))
}
const percentile = (values: number[], fraction: number) => {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}
const sum = (rows: Record<string, string>[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0)
const results: Record<string, string | number>[] = []
for (const round of readdirSync(output).filter(name => name.startsWith('round-'))) {
    for (const mode of readdirSync(resolve(output, round))) {
        const folder = resolve(output, round, mode)
        if (!existsSync(resolve(folder, 'frames.csv'))) continue
        const metadata = Object.fromEntries(readFileSync(resolve(folder, 'run.txt'), 'utf8').split(/\r?\n/).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
        if (metadata.error) throw new Error(`测试失败：${folder}: ${metadata.error}`)
        const frames = parse(resolve(folder, 'frames.csv'))
        const inputs = parse(resolve(folder, 'inputs.csv'))
        for (const phase of ['home', 'animation']) {
            const rows = frames.filter(frame => frame.phase === phase)
            if (!rows.length || rows.some(frame => Number(frame.failed))) throw new Error(`阶段没有成功帧：${folder} ${phase}`)
            const painted = rows.filter(frame => Number(frame.paints) > 0)
            const intervals = rows.slice(1).map((frame, index) => Number(frame.time_ms) - Number(rows[index].time_ms))
            const paints = sum(rows, 'paints')
            const seconds = Number(metadata.seconds_per_phase)
            const result: Record<string, string | number> = {
                round, mode, phase,
                published_frames: rows.length,
                paint_callbacks: paints,
                inputs: inputs.filter(input => input.phase === phase && ['wheel', 'toggle-animation'].includes(input.action)).length,
                process_cpu_ms: Number(metadata[`${phase}_process_cpu_ms`] ?? 0),
                process_cpu_ms_per_second: Number(metadata[`${phase}_process_cpu_ms`] ?? 0) / seconds,
                pipeline_cpu_mean_ms: sum(rows, 'pipeline_cpu_ms') / rows.length,
                paint_cpu_mean_ms: sum(rows, 'paint_cpu_ms') / Math.max(1, paints),
                painted_revision_p50_ms: percentile(painted.map(frame => Number(frame.paint_cpu_ms)), 0.5),
                painted_revision_p95_ms: percentile(painted.map(frame => Number(frame.paint_cpu_ms)), 0.95),
                publish_interval_p50_ms: percentile(intervals, 0.5),
                publish_interval_p95_ms: percentile(intervals, 0.95),
                publish_interval_p99_ms: percentile(intervals, 0.99),
                framework_cpu_ms_per_second: (sum(rows, 'pipeline_cpu_ms') + sum(rows, 'paint_cpu_ms')) / seconds,
                bitmap_retained_bytes_max: Math.max(...rows.map(row => Number(row.bitmap_retained_bytes))),
            }
            for (const key of ['bitmapHits', 'bitmapBuilds', 'bitmapEvictions', 'nativeConversions', 'nativeBytes', 'svgMaskBuilds', 'svgMaskHits', 'bitmapBuildMillis', 'nativeConvertMillis', 'svgMaskMillis']) result[key] = sum(rows, key)
            results.push(result)
        }
    }
}
if (!results.length) throw new Error('没有可分析的成功测试')
writeFileSync(resolve(output, 'summary.json'), JSON.stringify(results, null, 2))
const keys = Object.keys(results[0])
writeFileSync(resolve(output, 'summary.csv'), `${keys.join(',')}\n${results.map(row => keys.map(key => row[key]).join(',')).join('\n')}\n`)
for (const phase of ['home', 'animation']) {
    console.log(`[RenderAttribution] ${phase}，以下为各轮均值的中位数；发布间隔不是呈现帧时间`)
    const modes = [...new Set(results.map(row => row.mode))]
    console.table(modes.map(mode => {
        const rows = results.filter(row => row.mode === mode && row.phase === phase)
        const median = (key: string) => Number(percentile(rows.map(row => Number(row[key])), 0.5).toFixed(3))
        return { mode, processCpuPerSecond: median('process_cpu_ms_per_second'), frameworkCpuPerSecond: median('framework_cpu_ms_per_second'), bitmapBuildMs: median('bitmapBuildMillis'), nativeMs: median('nativeConvertMillis'), svgMs: median('svgMaskMillis') }
    }))
    console.table(modes.map(mode => {
        const rows = results.filter(row => row.mode === mode && row.phase === phase)
        const median = (key: string) => Number(percentile(rows.map(row => Number(row[key])), 0.5).toFixed(3))
        return { mode, rounds: rows.length, inputs: median('inputs'), pipeline: median('pipeline_cpu_mean_ms'), paint: median('paint_cpu_mean_ms'), paintP95: median('painted_revision_p95_ms'), publishP50: median('publish_interval_p50_ms'), publishP95: median('publish_interval_p95_ms'), bitmapHits: median('bitmapHits'), bitmapBuilds: median('bitmapBuilds'), svgHits: median('svgMaskHits'), svgBuilds: median('svgMaskBuilds') }
    }))
}
