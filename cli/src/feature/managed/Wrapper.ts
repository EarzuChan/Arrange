export interface TextSpan {
    readonly start: number
    readonly end: number
}

export type WrappedLocation = { readonly kind: "located", readonly outer: TextSpan, readonly inner: TextSpan } | { readonly kind: "missing" } | { readonly kind: "damaged", readonly message: string }

interface Tag {
    readonly id: string
    readonly edge: "begin" | "end"
    readonly start: number
    readonly end: number
}

// Wrapper致敬传奇XmlDom。Outer=或含Wrapper，Inner=内部正文

// 区间与 string.slice 一致；开闭标记各占一行，inner 不含这两行
export class Wrapper {
    constructor(readonly id: string) {
        if (!/^(cluster|region):[\w.-]+$/.test(id)) throw new Error(`非法 Wrapper 标识：${id}`)
    }

    get begin(): string { return `# arrange:begin ${this.id}` }

    get end(): string { return `# arrange:end ${this.id}` }

    get marker(): string { return `# arrange:insert ${this.id}` }

    make(inner: string): string {
        if (inner !== "" && !inner.endsWith("\n")) throw new Error(`${this.id} 的非空正文必须以换行结束`)
        return `${this.begin}\n${inner}${this.end}\n`
    }

    locate(text: string): WrappedLocation {
        const tags: Tag[] = [...text.matchAll(/^[\t ]*# arrange:(begin|end) ((?:cluster|region):[\w.-]+)[\t ]*(?:\r?\n|$)/gm)].map(m => ({ id: m[2], edge: m[1] as Tag["edge"], start: m.index, end: m.index + m[0].length }))

        const own = tags.filter(tag => tag.id === this.id)
        if (own.length === 0) return { kind: "missing" }
        if (own.length !== 2 || own[0].edge !== "begin" || own[1].edge !== "end") return { kind: "damaged", message: `${this.id} 的标记缺失、重复或顺序错误` }
        const [begin, end] = own

        const outside = new Map<string, Tag[]>()

        for (const tag of tags) {
            if (tag.id === this.id) continue
            const group = outside.get(tag.id) ?? []
            group.push(tag)
            outside.set(tag.id, group)
        }

        for (const group of outside.values()) {
            // 子级自身缺端不影响父级定位；只有实际跨越本元素边界才阻断本元素
            for (let i = 0; i + 1 < group.length; i++) {
                const [a, b] = [group[i], group[i + 1]]
                if (a.edge !== "begin" || b.edge !== "end") continue
                if ((a.start < begin.start && b.start > begin.start && b.start < end.start) || (a.start > begin.start && a.start < end.start && b.start > end.start)) return { kind: "damaged", message: `${this.id} 与 ${a.id} 交叉闭合` }
                const sameLevel = a.id.split(":")[0] === this.id.split(":")[0]
                const contains = a.start < begin.start && b.start > end.start
                const contained = a.start > begin.start && b.start < end.start
                if (sameLevel && (contains || contained)) return { kind: "damaged", message: `${this.id} 与同级元素 ${a.id} 错误嵌套` }
            }
        }

        return { kind: "located", outer: { start: begin.start, end: end.end }, inner: { start: begin.end, end: end.start } }
    }

    locateMarker(text: string): TextSpan | null {
        const lines = [...text.matchAll(/^[\t ]*# arrange:insert ((?:cluster|region):[\w.-]+)[\t ]*(?:\r?\n|$)/gm)].filter(m => m[1] === this.id)

        return lines.length === 1 ? { start: lines[0].index, end: lines[0].index + lines[0][0].length } : null
    }
}