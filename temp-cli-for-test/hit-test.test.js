import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionDocument } from './tui/document.ts'
import { boxRows, layoutDocument, viewport, hitTest } from './tui/view.js'

const emptyRow = () => ({ spans: [] })

test('子控制台命中包含四条边框，排除引导线和框外留白', () => {
    const rows = [emptyRow(), ...boxRows(['output'], {
        width: 12, id: 'task', height: 6, prefix: [{ text: '│  ' }],
    }), emptyRow()]
    const view = viewport(rows, 20, 12)
    const top = view.top + 1
    for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 20; x++) {
            const inside = x >= 3 && x < 15 && y >= top && y < top + 8
            assert.deepEqual(hitTest(view, x, y), inside ? { kind: 'console', id: 'task' } : { kind: 'history' }, `${x},${y}`)
        }
    }
    assert.equal(hitTest(view, -1, top), undefined)
    assert.equal(hitTest(view, 20, top), undefined)
})

test('框顶滚出屏幕后，剩余可见部分仍保留精准命中区域', () => {
    const rows = [emptyRow(), ...boxRows(['output'], {
        width: 12, id: 'task', height: 6, prefix: [{ text: '│  ' }],
    }), ...Array.from({ length: 8 }, emptyRow)]
    const view = viewport(rows, 20, 6, 4)
    for (let y = 0; y < 6; y++) {
        assert.deepEqual(hitTest(view, 3, y), y < 5 ? { kind: 'console', id: 'task' } : { kind: 'history' })
        assert.deepEqual(hitTest(view, 2, y), { kind: 'history' })
        assert.deepEqual(hitTest(view, 15, y), { kind: 'history' })
    }
})

test('前缀按单元格宽度计算，命中裁剪与实际绘制一致', () => {
    const rows = boxRows(['output'], { width: 12, id: 'task', height: 6, prefix: [{ text: '中  ' }] })
    const view = viewport(rows, 10, 8)
    assert.deepEqual(view.hitRegions[1], { x: 4, y: 0, width: 5, height: 8, target: { kind: 'console', id: 'task' } })
    assert.deepEqual(hitTest(view, 3, 0), { kind: 'history' })
    assert.deepEqual(hitTest(view, 4, 0), { kind: 'console', id: 'task' })
    assert.deepEqual(hitTest(view, 9, 0), { kind: 'history' })
})

test('各子控制台矩形随窗口尺寸和历史滚动独立更新', () => {
    const session = new SessionDocument()
    const batch = session.batch('测试', [{ id: 'one', title: '第一个任务', console: true }, { id: 'two', title: '第二个任务', console: true }])
    assert.equal(viewport(layoutDocument(session, 80), 80, 24).hitRegions.length, 1)
    for (const task of batch.tasks) {
        task.state = 'done'
        task.consoleStarted = true
        task.console.lines = Array.from({ length: 20 }, (_, index) => `第 ${index} 行`)
    }
    batch.state = 'done'
    session.phase = 'done'
    for (const columns of [3, 4, 5, 20, 80, 140]) {
        const rows = layoutDocument(session, columns)
        for (const height of [2, 12, 24, 80]) {
            for (const offset of [0, 10, Number.MAX_SAFE_INTEGER]) {
                const view = viewport(rows, columns, height, offset)
                for (let y = 0; y < height; y++) {
                    const index = y + view.offset - view.top
                    const boxIndex = rows.findIndex((row, top) => row.hitbox && index >= top && index < top + row.hitbox.height)
                    for (let x = 0; x < columns; x++) {
                        const box = rows[boxIndex]?.hitbox
                        const inside = box && x >= box.x && x < Math.min(columns - 1, box.x + box.width)
                        assert.deepEqual(hitTest(view, x, y), inside ? box.target : { kind: 'history' }, `${columns}x${height} offset=${offset} point=${x},${y}`)
                    }
                }
            }
        }
    }
})
