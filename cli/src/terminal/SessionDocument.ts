export type TaskState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'stopped'
export type Tone = 'info' | 'step' | 'success' | 'warn' | 'error'
export interface ConsoleContent { lines: string[], started: boolean }
export interface TaskContent { id: string, title: string, state: TaskState, detail?: string, stage?: string, note?: string, progress?: number, failure?: string, logPath?: string, console?: ConsoleContent }
export interface BatchContent { type: 'batch', title: string, state: TaskState, tasks: TaskContent[], transient?: boolean, messages?: { text: string, tone?: Tone }[] }
export interface RegionContent { type: 'region', id: string, entries: Entry[] }
export interface AnswerContent { type: 'answer', question: string, answer: string }
export interface PromptContent { kind: 'text' | 'select' | 'multiselect', question: string, options: string[], disabled?: readonly number[], index: number, selected: number[], value: string, cursor: number, placeholder: string, error?: string }
export type Entry = { type: 'heading' | 'message' | 'result', text: string, tone?: Tone } | AnswerContent | BatchContent | RegionContent
type Content = Exclude<Entry, RegionContent>
interface DocumentState { phase: 'active' | 'done' | 'failed' | 'cancelled', sequence: number }
interface Lifetime { closed: boolean, parent?: Lifetime, child?: Lifetime }

// 仅保存呈现事实，完成的控制台内容与执行资源分别持有
export class SessionDocument {
    private child?: SessionDocument
    constructor(readonly entries: Entry[] = [], private readonly state: DocumentState = { phase: 'active', sequence: 0 }, private readonly lifetime: Lifetime = { closed: false }) { }
    get phase(): DocumentState['phase'] { return this.state.phase }
    set phase(value: DocumentState['phase']) { this.state.phase = value }
    assertActive(): void {
        for (let scope: Lifetime | undefined = this.lifetime; scope; scope = scope.parent) if (scope.closed) throw new Error('流程区块已被替换或结束')
    }
    private assertWritable(): void {
        this.assertActive()
        if (this.lifetime.child && !this.lifetime.child.closed) throw new Error('当前流程区块结束后才能进入下一项')
    }
    contains(document: SessionDocument): boolean {
        for (let scope: Lifetime | undefined = document.lifetime; scope; scope = scope.parent) if (scope === this.lifetime) return true
        return false
    }
    activeDocument(): SessionDocument {
        this.assertActive()
        return this.child && !this.child.lifetime.closed ? this.child.activeDocument() : this
    }
    *contents(): Generator<Content> {
        yield* this.walk(this.entries)
    }
    private *walk(entries: readonly Entry[]): Generator<Content> {
        for (const entry of entries) {
            if (entry.type === 'region') yield* this.walk(entry.entries)
            else yield entry
        }
    }
    append(entry: Entry): void {
        this.advance()
        this.entries.push(entry)
    }
    advance(): void {
        this.assertWritable()
        const previous = this.entries.at(-1)
        if (previous?.type === 'batch' && previous.transient && previous.state === 'done' && !previous.tasks.some(task => task.console?.started)) this.entries.pop()
    }
    answer(question: string, answer: string): void { this.append({ type: 'answer', question, answer }) }
    region(): DocumentRegion {
        this.assertActive()
        const entry: RegionContent = { type: 'region', id: 'region-' + ++this.state.sequence, entries: [] }
        this.append(entry)
        return new DocumentRegion(entry, entries => {
            const lifetime: Lifetime = { closed: false, parent: this.lifetime }
            this.lifetime.child = lifetime
            return this.child = new SessionDocument(entries, this.state, lifetime)
        })
    }
    seal(): void { this.lifetime.closed = true }
    sealChildren(): void { this.child?.seal() }
    batch(title: string, transient = false): BatchContent {
        const batch: BatchContent = { type: 'batch', title, state: 'running', tasks: [], ...(transient ? { transient } : {}) }
        this.append(batch)
        return batch
    }
    task(batch: BatchContent, title: string, detail?: string): TaskContent {
        this.assertActive()
        const task: TaskContent = { id: 'task-' + ++this.state.sequence, title, detail, state: 'pending' }
        batch.tasks.push(task)
        return task
    }
}

// 区块身份保持稳定，替换覆盖整个区块，保留式完成留下当前内容
export class DocumentRegion {
    private current: SessionDocument
    constructor(private readonly entry: RegionContent, private readonly create: (entries: Entry[]) => SessionDocument) { this.current = create(entry.entries) }
    get document(): SessionDocument { return this.current }
    private assertReplaceable(): void {
        this.current.assertActive()
        for (const item of this.current.contents()) if (item.type === 'batch') {
            if (item.state === 'running') throw new Error('任务收尾后才能替换流程区块')
        }
    }
    replace(): SessionDocument {
        this.assertReplaceable()
        this.current.seal()
        this.entry.entries = []
        return this.current = this.create(this.entry.entries)
    }
    complete(answer?: Omit<AnswerContent, 'type'>): void {
        if (answer) {
            this.assertReplaceable()
            this.entry.entries = [{ type: 'answer', ...answer }]
        } else {
            this.current.assertActive()
            if ([...this.current.contents()].some(item => item.type === 'batch' && item.state === 'running')) throw new Error('任务收尾后才能结束流程区块')
        }
        this.current.seal()
    }
}
