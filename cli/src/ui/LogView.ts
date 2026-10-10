import { wrap } from "./Ansi.ts"

// 任务日志的内存缓冲与框内视口。行号（seq）从 0 递增、永不复用；超过容量时丢弃最旧的行（完整内容在日志文件里）。

export class LogBuffer {
    private readonly lines: string[] = []
    private head = 0
    private first = 0
    private next = 0
    partial: string | undefined

    constructor(readonly capacity = 50_000) { }

    get firstSeq(): number { return this.first }
    get nextSeq(): number { return this.next }
    get dropped(): number { return this.first }
    get size(): number { return this.next - this.first }

    append(line: string): void {
        if (this.lines.length < this.capacity) this.lines.push(line)
        else {
            this.lines[this.head] = line
            this.head = (this.head + 1) % this.capacity
            this.first++
        }
        this.next++
    }

    line(seq: number): string {
        if (seq < this.first || seq >= this.next) throw new RangeError(`日志行 ${seq} 不在缓冲内`)
        return this.lines[(this.head + seq - this.first) % this.lines.length]!
    }

    tail(count: number): string[] {
        const result: string[] = []
        for (let seq = Math.max(this.first, this.next - count); seq < this.next; seq++) result.push(this.line(seq))
        return result
    }
}

interface Position {
    readonly seq: number
    readonly row: number
}

export interface LogWindow {
    readonly rows: readonly string[]
    // 视口上方、下方未显示的逻辑行数（含被折行的行按一行计）
    readonly linesAbove: number
    readonly linesBelow: number
    readonly following: boolean
}

// 视口以“顶部所在的折行行”为锚点：不跟随时新日志到来内容保持不动；跟随时始终显示末尾
export class LogViewport {
    private follow = true
    private top: Position = { seq: 0, row: 0 }
    private cacheWidth = 0
    private cache = new Map<number, readonly string[]>()

    constructor(private readonly buffer: LogBuffer) { }

    get following(): boolean { return this.follow }

    scroll(deltaRows: number, width: number, height: number): void {
        if (deltaRows === 0) return
        this.prepare(width)
        if (this.follow) {
            if (deltaRows > 0) return
            this.top = this.bottomWindowTop(height)
            this.follow = false
        }
        this.clampTop()
        let { seq, row } = this.top
        const first = this.buffer.firstSeq
        const last = this.lastSeq()
        if (last < first) {
            this.follow = true
            return
        }
        if (deltaRows < 0) {
            let remaining = -deltaRows
            while (remaining > 0) {
                if (row >= remaining) {
                    row -= remaining
                    remaining = 0
                } else {
                    remaining -= row
                    if (seq <= first) {
                        row = 0
                        break
                    }
                    seq--
                    row = this.rowsOf(seq).length
                }
            }
            this.top = { seq, row: Math.min(row, this.rowsOf(seq).length - 1) }
        } else {
            let remaining = deltaRows
            while (remaining > 0 && seq <= last) {
                const count = this.rowsOf(seq).length
                if (row + remaining < count) {
                    row += remaining
                    remaining = 0
                } else {
                    remaining -= count - row
                    seq++
                    row = 0
                }
            }
            if (seq > last) this.follow = true
            else this.top = { seq, row }
        }
        if (!this.follow && this.rowsFrom(this.top, height) < height) this.follow = true
    }

    toTop(width: number, height: number): void {
        this.prepare(width)
        if (this.lastSeq() < this.buffer.firstSeq) return
        this.top = { seq: this.buffer.firstSeq, row: 0 }
        this.follow = this.rowsFrom(this.top, height) < height
    }

    toBottom(): void { this.follow = true }

    window(width: number, height: number): LogWindow {
        this.prepare(width)
        const last = this.lastSeq()
        const first = this.buffer.firstSeq
        if (height <= 0 || last < first) return { rows: [], linesAbove: 0, linesBelow: 0, following: this.follow }
        if (this.follow) {
            const rows: string[] = []
            let seq = last
            let topSeq = last
            while (seq >= first && rows.length < height) {
                const lineRows = this.rowsOf(seq)
                rows.unshift(...lineRows.slice(Math.max(0, lineRows.length - (height - rows.length))))
                topSeq = seq
                seq--
            }
            return { rows, linesAbove: topSeq - first, linesBelow: 0, following: true }
        }
        this.clampTop()
        const rows: string[] = []
        let seq = this.top.seq
        let row = this.top.row
        let bottomSeq = seq
        while (seq <= last && rows.length < height) {
            const lineRows = this.rowsOf(seq)
            rows.push(...lineRows.slice(row, row + height - rows.length))
            bottomSeq = seq
            seq++
            row = 0
        }
        return { rows, linesAbove: this.top.seq - first, linesBelow: last - bottomSeq, following: false }
    }

    // 未换行的当前输出作为最后一个伪行参与显示
    private lastSeq(): number {
        return this.buffer.partial !== undefined ? this.buffer.nextSeq : this.buffer.nextSeq - 1
    }

    private text(seq: number): string {
        return seq === this.buffer.nextSeq ? this.buffer.partial ?? "" : this.buffer.line(seq)
    }

    private rowsOf(seq: number): readonly string[] {
        if (seq === this.buffer.nextSeq) return wrap(this.text(seq), this.cacheWidth)
        let rows = this.cache.get(seq)
        if (!rows) {
            if (this.cache.size > 8000) this.cache.clear()
            rows = wrap(this.text(seq), this.cacheWidth)
            this.cache.set(seq, rows)
        }
        return rows
    }

    private prepare(width: number): void {
        const effective = Math.max(1, Math.floor(width))
        if (effective === this.cacheWidth) return
        this.cacheWidth = effective
        this.cache.clear()
        if (!this.follow) this.top = { seq: this.top.seq, row: 0 }
    }

    private clampTop(): void {
        const first = this.buffer.firstSeq
        if (this.top.seq < first) this.top = { seq: first, row: 0 }
        const last = this.lastSeq()
        if (this.top.seq > last) this.top = { seq: Math.max(first, last), row: 0 }
        if (this.top.seq <= last && this.top.seq >= first) this.top = { seq: this.top.seq, row: Math.min(this.top.row, this.rowsOf(this.top.seq).length - 1) }
    }

    private bottomWindowTop(height: number): Position {
        const first = this.buffer.firstSeq
        let seq = this.lastSeq()
        let remaining = height
        while (seq >= first) {
            const count = this.rowsOf(seq).length
            if (count >= remaining) return { seq, row: count - remaining }
            remaining -= count
            if (seq === first) break
            seq--
        }
        return { seq: Math.max(first, seq), row: 0 }
    }

    // 从给定位置向下最多数到 limit 行
    private rowsFrom(position: Position, limit: number): number {
        const last = this.lastSeq()
        let count = 0
        let seq = position.seq
        let row = position.row
        while (seq <= last && count < limit) {
            count += this.rowsOf(seq).length - row
            seq++
            row = 0
        }
        return count
    }
}
