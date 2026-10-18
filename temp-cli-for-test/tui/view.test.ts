import assert from 'node:assert/strict'
import test from 'node:test'
import stringWidth from 'string-width'
import { SessionDocument } from './document.ts'
import { boxRows, layoutDocument, viewport, TranscriptRenderer } from './view.js'
import { ViewportController } from './viewport-controller.ts'

const rowText = (row: { spans: { text: string }[] }): string => row.spans.map(part => part.text).join('')

test('首个问题、后续问题和任务批次统一在主项前留一行，拍扁保持相同规则', () => {
    const document = new SessionDocument()
    document.entries.push({ type: 'heading', text: '标题' }, { type: 'message', text: '说明' })
    document.prompt = { kind: 'select', question: '首个问题', options: ['选项'], cursor: 0, selected: [], value: '', placeholder: '' }
    assert.deepEqual(layoutDocument(document, 80).map(rowText).slice(0, 4), ['┌  标题', '│  说明', '│  ', '◆  首个问题'])
    document.entries.push({ type: 'answer', question: '首个问题', answer: '选项' })
    document.prompt.question = '后续问题'
    assert.deepEqual(layoutDocument(document, 80).map(rowText).slice(2, 7), ['│  ', '◇  首个问题', '│  选项', '│  ', '◆  后续问题'])
    document.prompt = null
    document.entries.push({ type: 'answer', question: '后续问题', answer: '答案' }, { type: 'message', text: '检查完成' })
    document.batch('任务', [])
    const expected = ['┌  标题', '│  说明', '│', '◇  首个问题', '│  选项', '│', '◇  后续问题', '│  答案', '│  检查完成', '│', '◒ 正在 任务']
    assert.deepEqual(layoutDocument(document, 80).map(rowText).map(line => line.trimEnd()), expected)
    assert.equal(new TranscriptRenderer().render(document), '\n' + expected.join('\n') + '\n\n')
    const standalone = new SessionDocument()
    standalone.entries.push({ type: 'answer', question: '独立问题', answer: '答案' })
    assert.equal(layoutDocument(standalone, 80).map(rowText)[0], '◇  独立问题')
})

test('子控制台完成标记保留六行高度、滚动内容和相邻任务连续布局，拍扁展开全部原行', () => {
    const document = new SessionDocument()
    const batch = document.batch('任务', [{ id: 'one', title: '任务一', console: true }, { id: 'two', title: '任务二', console: true }])
    const [first, second] = batch.tasks
    for (const task of batch.tasks) {
        task.state = 'running'
        task.consoleStarted = true
        task.console!.lines = Array.from({ length: 12 }, (_, index) => '输出 ' + index)
    }
    assert.ok(!layoutDocument(document, 80).map(rowText).some(line => line.includes('╰─已完成')))
    first.state = 'done'
    const tail = layoutDocument(document, 80).map(rowText)
    const scrolled = layoutDocument(document, 80, { [first.id]: 0 }).map(rowText)
    const footer = scrolled.findIndex(line => line.startsWith('│  ╰─已完成'))
    assert.ok(tail.some(line => line.includes('输出 11')))
    assert.ok(scrolled.some(line => line.includes('输出 0')))
    assert.equal(footer - scrolled.findIndex(line => line.startsWith('│  ╭')), 7)
    assert.ok(scrolled[footer + 1].startsWith('│  ◒ 任务二'))
    assert.equal(scrolled.filter(line => line.startsWith('│  ╰─已完成')).length, 1)
    second.state = 'done'
    batch.state = 'done'
    document.entries.push({ type: 'result', text: '已完成' })
    document.phase = 'done'
    assert.deepEqual(layoutDocument(document, 80).map(rowText).slice(-3), ['└  已完成', '', '   按 Enter 退出并拍扁完整历史'])
    const transcript = new TranscriptRenderer().render(document)
    assert.ok(!transcript.includes('按 Enter'))
    assert.equal(transcript.split('\n').filter(line => line.startsWith('│  ╰─已完成')).length, 2)
    for (const line of first.console!.lines) assert.ok(transcript.includes(line))
    first.console!.lines = []
    const emptyFooter = new TranscriptRenderer().render(document).split('\n').find(line => line.startsWith('│  ╰─已完成'))
    assert.ok(emptyFooter?.endsWith('╯'))
})

test('完成文字按单元格宽度裁剪，窄框仍保留左右边角和准确框宽', () => {
    for (const bottomLabel of ['已完成', '已取消', '已退出']) for (const width of [2, 3, 4, 7, 8, 9, 12, 80]) {
        const rows = boxRows(['短'], { width, height: 6, bottomLabel }).map(rowText)
        assert.equal(rows.length, 8)
        assert.ok(rows.every(line => stringWidth(line) === width))
        assert.ok(rows.at(-1)?.startsWith('╰'))
        assert.ok(rows.at(-1)?.endsWith('╯'))
        if (width >= 9) assert.ok(rows.at(-1)?.startsWith('╰─' + bottomLabel))
    }
})

test('子控制台顶边区分上下可滚方向与跟随状态，短内容不虚报方向，拍扁不保留视口提示', () => {
    const document = new SessionDocument()
    const task = document.batch('任务', [{ id: 'task', title: '任务', console: true }]).tasks[0]
    task.consoleStarted = true
    task.state = 'running'
    task.console!.lines = Array.from({ length: 12 }, (_, index) => '输出 ' + index)
    const header = (offsets: Record<string, number>) => layoutDocument(document, 80, offsets).map(rowText).find(line => line.startsWith('│  ╭'))!
    assert.ok(header({}).startsWith('│  ╭─可往上滚·跟随中'))
    assert.ok(header({ [task.id]: 0 }).startsWith('│  ╭─可往下滚─'))
    assert.ok(header({ [task.id]: 3 }).startsWith('│  ╭─可上下滚─'))
    assert.ok(header({ [task.id]: 6 }).startsWith('│  ╭─可往上滚─'))
    task.state = 'done'
    assert.ok(header({}).startsWith('│  ╭─可往上滚·跟随中'))
    const transcript = new TranscriptRenderer().render(document)
    for (const hint of ['可往上滚', '可往下滚', '可上下滚', '跟随中']) assert.ok(!transcript.includes(hint))
    for (const length of [0, 3, 6]) {
        task.console!.lines.length = length
        assert.ok(header({}).startsWith('│  ╭─跟随中─'))
        assert.ok(!header({}).includes('可往'))
    }
    for (const width of [2, 3, 4, 7, 12, 24, 80]) {
        const rows = boxRows([], { width, height: 6, topLabel: '可往上滚·跟随中' }).map(rowText)
        assert.ok(rows.every(line => stringWidth(line) === width))
        assert.ok(rows[0].startsWith('╭') && rows[0].endsWith('╮'))
    }
})

test('向上滚动暂停跟随，滚回底部后新增输出持续跟随，滚动不足六行内容不会锁死跟随', () => {
    const document = new SessionDocument()
    const task = document.batch('任务', [{ id: 'task', title: '任务', console: true }]).tasks[0]
    task.consoleStarted = true
    task.state = 'running'
    const frames: string[] = []
    const terminal = { columns: 80, rows: 24, writeFrame: (frame: string) => { frames.push(frame) } }
    const controller = new ViewportController(document, terminal)
    controller.render()
    const region = viewport(layoutDocument(document, terminal.columns), terminal.columns, terminal.rows).hitRegions[1]
    controller.wheel(region.x, region.y, -1)
    task.console!.lines = Array.from({ length: 12 }, (_, index) => '输出 ' + index)
    controller.render()
    assert.ok(frames.at(-1)?.includes('可往上滚·跟随中'))
    assert.ok(frames.at(-1)?.includes('输出 11'))
    controller.wheel(region.x, region.y, -1)
    controller.render()
    assert.ok(frames.at(-1)?.includes('可上下滚'))
    assert.ok(!frames.at(-1)?.includes('跟随中'))
    task.console!.lines.push('输出 12', '输出 13')
    controller.render()
    assert.ok(frames.at(-1)?.includes('输出 3'))
    assert.ok(!frames.at(-1)?.includes('输出 13'))
    controller.wheel(region.x, region.y, -100)
    controller.render()
    assert.ok(frames.at(-1)?.includes('可往下滚'))
    controller.wheel(region.x, region.y, 100)
    controller.render()
    task.console!.lines.push('输出 14')
    controller.render()
    assert.ok(frames.at(-1)?.includes('可往上滚·跟随中'))
    assert.ok(frames.at(-1)?.includes('输出 14'))
})
