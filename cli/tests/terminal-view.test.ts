import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionDocument } from '../src/terminal/SessionDocument.ts'
import { TaskController } from '../src/terminal/TaskController.ts'
import { layoutDocument } from '../src/terminal/DocumentRenderer.ts'
import { hitTest, viewport, type Row } from '../src/terminal/LayoutModel.ts'
import { ScreenRenderer } from '../src/terminal/ScreenRenderer.ts'
import { TranscriptRenderer } from '../src/terminal/TranscriptRenderer.ts'
import { ViewportController } from '../src/terminal/ViewportController.ts'
import { stripAnsi, visibleWidth } from '../src/util/TerminalText.ts'

const rowText = (row: Row) => stripAnsi(row.spans.map(part => part.text).join(''))

test('单任务提升为主行时符号后留两格，任务组内子项仍按层级排列', () => {
    const document = new SessionDocument()
    const batch = document.batch('检查候选')
    const task = document.task(batch, '检查候选')
    for (const state of ['pending', 'running', 'done', 'failed', 'cancelled', 'stopped'] as const) {
        task.state = state
        batch.state = state === 'pending' ? 'running' : state
        for (const flatten of [false, true]) assert.match(layoutDocument(document, 80, {}, 0, undefined, flatten).map(rowText)[0]!, /^[○◒◐◓◑✓■] {2}检查候选/)
    }
    const other = document.task(batch, '其它任务')
    other.state = 'done'
    batch.state = 'done'
    const rows = layoutDocument(document, 80).map(rowText)
    assert.equal(rows[0], '◇  检查候选 完成')
    assert.ok(rows.includes('│  ✓ 其它任务 · 已完成'))
})
function fixture() {
    const document = new SessionDocument()
    document.entries.push({ type: 'heading', text: '标题' }, { type: 'message', text: '说明' })
    const batch = document.batch('SETUP')
    const task = document.task(batch, 'CMake')
    task.state = 'done'
    task.console = { started: true, lines: Array.from({ length: 20 }, (_, index) => '输出 ' + index) }
    batch.state = 'done'
    return { document, batch, task }
}

test('线性历史统一主项留白、完整框线、固定六行和滚动方向标注', () => {
    const { document, task } = fixture()
    const tail = layoutDocument(document, 80)
    const text = tail.map(rowText)
    assert.equal(text[2], '│  ')
    const top = text.findIndex(line => line.includes('╭'))
    assert.match(text[top]!, /╭─可往上滚·跟随中/)
    assert.match(text[top + 7]!, /╰─已完成/)
    assert.equal(visibleWidth(text[top]!), visibleWidth(text[top + 1]!))
    assert.equal(visibleWidth(text[top]!), visibleWidth(text[top + 7]!))
    assert.match(layoutDocument(document, 80, { [task.id]: 0 }).map(rowText).join('\n'), /╭─可往下滚/)
    assert.match(layoutDocument(document, 80, { [task.id]: 4 }).map(rowText).join('\n'), /╭─可上下滚/)
})

test('任务不额外显示阶段与状态附文，运行及拍扁均保留错误和已保存日志提示', () => {
    const { document, task } = fixture()
    task.stage = '编译'
    task.note = '运行中'
    for (const state of ['running', 'done', 'failed'] as const) {
        task.state = state
        task.failure = state === 'failed' ? '实际错误原因' : undefined
        for (const flatten of [false, true]) {
            const lines = layoutDocument(document, 80, {}, 0, undefined, flatten).map(rowText)
            const title = lines.findIndex(line => line.includes('CMake'))
            assert.match(lines[title + (state === 'failed' ? 2 : 1)]!, /╭/)
            assert.ok(!lines.some(line => line.includes('编译') || line.includes('运行中')))
        }
    }
    task.failure = '实际错误原因'
    task.logPath = 'failed.log'
    const text = layoutDocument(document, 80).map(rowText).join('\n')
    assert.match(text, /实际错误原因/)
    assert.match(text, /已记录到 failed.log/)
})

test('子控制台命中仅含边框矩形，外侧引导线和留白自然归历史', () => {
    const { document, task } = fixture()
    const rows = layoutDocument(document, 80)
    const view = viewport(rows, 80, 30, 0)
    const box = view.hitboxes[0]!
    assert.equal(hitTest(view, box.x, box.y), task.id)
    assert.equal(hitTest(view, box.x + box.width - 1, box.y + box.height - 1), task.id)
    assert.equal(hitTest(view, box.x - 1, box.y), undefined)
    assert.equal(hitTest(view, box.x + box.width, box.y), undefined)
    assert.equal(hitTest(view, box.x, box.y - 1), undefined)
    assert.equal(hitTest(view, box.x, box.y + box.height), undefined)
    const clipped = viewport(rows, 80, 4, rows.length)
    assert.ok(clipped.hitboxes[0]!.height < 8)
    assert.equal(hitTest(clipped, 3, 0), task.id)
})

test('短内容贴底，极窄与极矮尺寸只裁剪画面不丢文档', () => {
    const { document } = fixture()
    const transcript = new TranscriptRenderer().render(document)
    for (const columns of [1, 2, 3, 4, 12, 80]) for (const height of [1, 2, 8, 40]) {
        const rows = layoutDocument(document, columns)
        const view = viewport(rows, columns, height, Number.MAX_SAFE_INTEGER)
        const frame = new ScreenRenderer().frame(view, false)
        for (const line of frame.split('\n')) assert.ok(visibleWidth(line) <= Math.max(0, columns - 1))
        assert.equal(new TranscriptRenderer().render(document), transcript)
    }
    const rows = layoutDocument(document, 80)
    const view = viewport(rows, 80, 40, 0)
    assert.equal(view.rows.length, 40)
    assert.equal(rowText(view.rows[0]!), '')
    assert.match(rowText(view.rows.at(-1)!), /╰─已完成/)
})

test('拍扁展开全部原行、按文本撑开框宽、保留侧边框且首尾各一空行', () => {
    const { document, task } = fixture()
    task.console!.lines.push('很长😀'.repeat(60))
    const result = new TranscriptRenderer().render(document)
    assert.ok(result.startsWith('\n┌'))
    assert.ok(result.endsWith('\n\n'))
    assert.ok(result.includes('很长😀'.repeat(60)))
    assert.ok(!result.includes('跟随中'))
    assert.ok(!result.includes('按 Enter'))
    const lines = result.split('\n').filter(line => /│  [╭│╰]/.test(line))
    assert.equal(new Set(lines.map(visibleWidth)).size, 1)
    assert.ok(result.includes('输出 0'))
    assert.ok(result.includes('输出 19'))
})

test('普通任务不创建控制台，完成后荧幕仍可滚动且新增输出在底部跟随', async () => {
    const document = new SessionDocument()
    const tasks = new TaskController(document, () => { })
    const batch = tasks.group('任务')
    const simple = batch.task('纯计算')
    simple.start()
    simple.progress(0.5)
    assert.equal(layoutDocument(document, 80).filter(row => row.hitbox).length, 0)
    await simple.finish('done')
    const console = batch.task('工具')
    console.start()
    console.console(Array.from({ length: 20 }, (_, index) => 'line ' + index).join('\r\n'))
    await console.finish('done')
    batch.complete()
    const frames: string[] = []
    const controller = new ViewportController(document, { columns: 80, rows: 40, writeFrame: frame => { frames.push(stripAnsi(frame)) } })
    controller.render(0)
    const box = viewport(layoutDocument(document, 80), 80, 40, 0).hitboxes[0]!
    controller.wheel(box.x, box.y, -1)
    controller.render(0)
    assert.ok(frames.at(-1)!.includes('可上下滚'))
    controller.wheel(box.x, box.y, 100)
    controller.render(0)
    assert.ok(frames.at(-1)!.includes('可往上滚·跟随中'))
    assert.ok(frames.at(-1)!.includes('╰─已完成'))
})

test('选项多于屏高时围绕当前项呈现，默认选择与多选小圆标仍可见', () => {
    const document = new SessionDocument()
    const options = Array.from({ length: 100 }, (_, index) => '选项 ' + index)
    for (const index of [0, 50, 99]) {
        const rows = layoutDocument(document, 80, {}, 0, { kind: 'multiselect', question: '模块', options, index, selected: [index], value: '', cursor: 0, placeholder: '' }, false, 12)
        assert.ok(rows.length <= 12)
        assert.ok(rows.map(rowText).some(line => line.includes('› ● 选项 ' + index)))
    }
})
