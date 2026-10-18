import type { CommandUi } from './tui/index.ts'
import { modules, prepare } from './simulation.ts'

// 命令编排只调用语义交互 API 和业务服务，不处理终端输入或绘制
export async function runDemo(ui: CommandUi, signal: AbortSignal, prepareWork = prepare): Promise<void> {
    ui.heading('Arrange CLI · 自有简易 TUI 原型')

    ui.message('线性提问 → 模拟任务 → Enter 拍扁退出')

    await ui.select('项目模板', [{ value: 'blank', label: '空白工程' }, { value: 'vue', label: 'Vue 风格模板' }])

    await ui.text('项目名', { placeholder: '请输入项目名', defaultValue: 'my-project' })

    const selected = await ui.multiselect('同步模块', [{ value: 'ui', label: 'UI 依赖' }, { value: 'native-debug', label: 'native · debug' }, { value: 'native-release', label: 'native · release' }], ['ui', 'native-debug'])

    ui.message('CONFIG 检查完成 · 无需变更')

    const enabled = new Set<string>(selected)

    const batch = ui.tasks('SETUP', [{ id: 'check', title: '检查工程配置' }, ...modules.filter(module => enabled.has(module.id)).map(module => ({ id: module.id, title: module.title, console: true }))])

    const started = new Set<string>(), completed = new Set<string>(), outputCounts = new Map<string, number>()

    for await (const events of prepareWork(selected, signal)) for (const event of events) {
        if (event.state === 'pending' || completed.has(event.id)) continue

        const task = batch.task(event.id)
        if (!started.has(event.id)) {
            task.start()
            started.add(event.id)
        }
        task.progress(event.progress)
        const lines = event.lines.slice(outputCounts.get(event.id) ?? 0)
        if (lines.length) {
            task.append(lines)
            outputCounts.set(event.id, event.lines.length)
        }
        if (event.state === 'done') {
            task.complete()
            completed.add(event.id)
        }
    }

    batch.complete()

    ui.result('Arrange 同步已完成')
}
