import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map-js'

// 连接代码搬移/插入与 SFA、Vite 原有映射，保留最初的源码位置
export function composeSourceMap(map: RawSourceMap, previous?: RawSourceMap | null): RawSourceMap {
    if (!previous) return map
    const before = new SourceMapConsumer(previous)
    const after = new SourceMapConsumer(map)
    const composed = new SourceMapGenerator({ file: map.file })
    after.eachMapping(mapping => {
        if (mapping.originalLine == null || mapping.originalColumn == null) return
        const original = before.originalPositionFor({ line: mapping.originalLine, column: mapping.originalColumn })
        if (original.source && original.line != null && original.column != null) composed.addMapping({ generated: { line: mapping.generatedLine, column: mapping.generatedColumn }, original: { line: original.line, column: original.column }, source: original.source, name: original.name ?? undefined })
    })
    for (const name of before.sources) composed.setSourceContent(name, before.sourceContentFor(name))
    return JSON.parse(composed.toString())
}
