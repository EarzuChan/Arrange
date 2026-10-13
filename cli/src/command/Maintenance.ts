import type { Command } from "commander"
import { confirm, isCancel, multiselect, select } from "@clack/prompts"
import { dirname, resolve } from "node:path"
import type { CliTerminal } from "../ui/Terminal.ts"
import type { ProjectStateStore } from "../project/ProjectStateStore.ts"
import type { ProjectOperations } from "../operation/ProjectOperations.ts"
import type { Operations } from "../operation/Operations.ts"
import type { Resource } from "../operation/Resource.ts"
import type { UserDirectories } from "../user/UserDirectories.ts"
import type { ProjectRegistry } from "../user/ProjectRegistry.ts"
import type { ProjectCleaner, CleanOptions } from "../storage/ProjectCleaner.ts"
import type { StorageInventory } from "../storage/StorageInventory.ts"
import type { StorageMaintenance } from "../storage/StorageMaintenance.ts"
import { RecoveryService } from "../transaction/RecoveryService.ts"
import { TransactionStore } from "../transaction/TransactionStore.ts"
import { treeIdentity } from "../transaction/TreeState.ts"

interface Dependencies {
    readonly terminal: CliTerminal
    readonly store: ProjectStateStore
    readonly projects: ProjectOperations
    readonly operations: Operations
    readonly directories: UserDirectories
    readonly registry: ProjectRegistry
    readonly cleaner: ProjectCleaner
    readonly inventory: StorageInventory
    readonly maintenance: StorageMaintenance
    readonly lifetime: Resource
    readonly signal: AbortSignal
    readonly interactive: boolean
}

export function registerMaintenanceCommands(program: Command, input: Dependencies): void {
    const { terminal, signal } = input
    const ask = async (message: string): Promise<boolean> => {
        if (!input.interactive) throw new Error("需要交互确认；请使用 --scan 查看计划")
        const answer = await confirm({ ...terminal.prompt, message, active: "确认", inactive: "取消" })
        signal.throwIfAborted()
        return !isCancel(answer) && answer
    }
    program.command("clean").description("清理当前工程的生成结果").option("--ui-only", "仅清理 UI 输出").option("--native-only", "仅清理原生构建树").option("--artifacts-only", "仅清理受管交付物").option("--artifacts", "同时清理受管交付物").option("--flavor <flavor>", "原生配置：debug 或 release").option("--scan", "只查看计划")
        .action(async (options: { uiOnly?: boolean, nativeOnly?: boolean, artifactsOnly?: boolean, artifacts?: boolean, flavor?: string, scan?: boolean }) => {
            if ([options.uiOnly, options.nativeOnly, options.artifactsOnly].filter(Boolean).length > 1 || options.artifacts && (options.uiOnly || options.nativeOnly || options.artifactsOnly)) throw new Error("清理范围参数互斥")
            if (options.flavor && !["debug", "release"].includes(options.flavor) || options.flavor && (options.uiOnly || options.artifactsOnly)) throw new Error("--flavor 只接受原生范围的 debug 或 release")
            const clean: CleanOptions = { ui: !options.nativeOnly && !options.artifactsOnly, native: !options.uiOnly && !options.artifactsOnly, artifacts: !!(options.artifacts || options.artifactsOnly), flavor: options.flavor as "debug" | "release" | undefined }
            const root = process.cwd()
            const plan = options.scan ? await input.projects.run(root, { configuration: "read", ui: clean.ui ? "read" : undefined, native: clean.native ? "read" : undefined, artifacts: clean.artifacts ? "read" : undefined, observe: true }, "查看工程清理计划", async () => input.cleaner.plan(await input.store.load(root), clean)) : await input.cleaner.plan(await input.store.load(root), clean)
            for (const entry of plan) terminal.reporter.info(`${entry.reason}：${entry.path}`)
            if (!plan.length || options.scan) return terminal.reporter.outro(plan.length ? "清理计划已展示，未修改" : "没有可清理内容")
            const identities = await Promise.all(plan.map(entry => treeIdentity(entry.path)))
            if (!await ask("确认清理以上内容？")) return terminal.reporter.cancelled("已取消清理")
            await input.projects.run(root, { configuration: "write", ui: clean.ui ? "write" : undefined, native: clean.native ? "write" : undefined, artifacts: clean.artifacts ? "write" : undefined }, "arrange clean", async () => {
                const current = await input.store.load(root)
                const next = await input.cleaner.plan(current, clean)
                if (JSON.stringify(next) !== JSON.stringify(plan) || JSON.stringify(await Promise.all(next.map(entry => treeIdentity(entry.path)))) !== JSON.stringify(identities)) throw new Error("清理计划在确认后发生变化，请重新运行")
                await input.cleaner.execute(current, next)
            })
            terminal.reporter.outro("工程清理完成")
        })
    const storage = program.command("storage").description("管理本用户 Arrange 存储")
    storage.command("inspect").description("查看工程登记与受管资源").action(async () => {
        for (const item of await input.inventory.inspect()) {
            let occupied = ""
            if (item.kind !== "project") try {
                await input.operations.run([{ kind: "directory", path: item.path, mode: "read" }], "查看存储占用", async () => { }, true)
            } catch (error) { occupied = ` · 无法稳定查看：${String(error)}` }
            const labels: Record<string, string> = { present: "正常", missing: "工程失联", unavailable: "无法检查", replaced: "登记失效", unknown: "归属或引用无法确认" }
            const size = item.kind === "project" ? "" : ` · ${item.sizeComplete ? "" : "至少 "}${item.bytes} 字节`
            terminal.reporter.info(`${item.id} · ${labels[item.status] ?? item.status}${occupied}${size}\n${item.path}${item.references.length ? `\n引用：${item.references.join("、")}` : ""}`)
        }
    })
    storage.command("clean").description("选择清理可释放的用户级资源").option("--scan", "只查看计划").action(async (options: { scan?: boolean }) => {
        const candidates = (await input.inventory.inspect()).filter(item => item.cleanable)
        for (const item of candidates) terminal.reporter.info(`${item.id} · ${item.bytes} 字节 · ${item.path}`)
        if (!candidates.length || options.scan) return terminal.reporter.outro(candidates.length ? "候选已展示，未修改" : "没有可清理内容")
        if (!input.interactive) throw new Error("需要交互选择；请使用 --scan 查看计划")
        const selected = await multiselect({ ...terminal.prompt, message: "选择要释放的资源", required: false, options: candidates.map(item => ({ value: item.id, label: `${item.id} · ${item.path}` })) })
        if (isCancel(selected) || !selected.length) return terminal.reporter.cancelled("已取消清理")
        const items = candidates.filter(item => selected.includes(item.id))
        const identities = await Promise.all(items.map(item => treeIdentity(item.path)))
        if (!await ask("确认清理所选资源？")) return terminal.reporter.cancelled("已取消清理")
        await input.operations.run([{ ...input.lifetime, mode: "write" }, ...items.map(item => ({ kind: "directory" as const, path: item.path, mode: "write" as const }))], "arrange storage clean", async () => {
            if (JSON.stringify(identities) !== JSON.stringify(await Promise.all(items.map(item => treeIdentity(item.path))))) throw new Error("所选资源在确认后变化，请重新查看")
            await input.maintenance.clean(items)
        }, true)
        terminal.reporter.outro("用户级清理完成")
    })
    storage.command("repair <id>").description("按确切 commit 修复源码缓存").option("--scan", "只查看影响").action(async (id: string, options: { scan?: boolean }) => {
        const key = id.replace(/^source:/, "")
        const item = (await input.inventory.inspect()).find(item => item.id === `source:${key}`)
        if (!item) throw new Error("未找到源码条目")
        terminal.reporter.info(`${item.path}\n受影响构建：${item.references.join("、") || "无"}`)
        if (options.scan) return
        if (!await ask("确认重新获取此源码快照，并使相关准备状态失效？")) return terminal.reporter.cancelled("已取消修复")
        await input.operations.run([{ ...input.lifetime, mode: "write" }, ...item.references.map(path => ({ kind: "directory" as const, path, mode: "write" as const }))], "arrange storage repair", () => terminal.tasks.run({ id: "source-repair", title: "修复共享源码" }, task => input.maintenance.repair(key, task)))
        terminal.reporter.outro("源码修复完成，请重新运行 native SETUP")
    })
    const registerRecovery = (command: Command, user: boolean): void => {
        command.command("recover [id]").description(user ? "恢复用户级维护事务" : "恢复当前工程事务").option("--scan", "只查看事务").action(async (id: string | undefined, options: { scan?: boolean }) => {
            const store = user ? new TransactionStore(input.directories.root, input.directories.transactions) : new TransactionStore(resolve(process.cwd()))
            const current = user ? undefined : (await input.store.deepLoad(store.root)).state
            const allowedRoots = user ? [input.directories.sources, input.directories.projects, input.directories.builds] : [store.root]
            if (current) allowedRoots.push(resolve(current.rootDir, current.project.ui.directory), resolve(current.rootDir, current.project.native.directory), ...(current.local?.native?.buildRoot ? [resolve(current.rootDir, current.local.native.buildRoot)] : [input.directories.builds]))
            if (user) for (const registration of await input.registry.list()) if (registration.record) allowedRoots.push(...registration.record.buildRoots, ...registration.record.buildTrees.map(path => dirname(path)))
            const recovery = new RecoveryService(store, input.operations, signal, { ...input.lifetime, mode: "write" }, allowedRoots)
            const records = await recovery.inspect(id)
            const kinds: Record<string, string> = { write: "文件写入", initialize: "工程初始化", replace: "产物替换", delete: "内容清理" }
            const statuses: Record<string, string> = { pending: "待执行", running: "未完成", failed: "失败待恢复", complete: "已完成待收尾" }
            for (const entry of records) terminal.reporter.info(`${entry.id} · ${entry.record ? kinds[entry.record.kind] : "未知"} · ${entry.record ? statuses[entry.record.status] : entry.error}`)
            if (!id) return
            const plan = await recovery.plan(id)
            for (const entry of plan.paths) terminal.reporter.info(entry.path)
            for (const conflict of plan.conflicts) terminal.reporter.error(conflict)
            terminal.reporter.info(`可用动作：${[...(plan.continue ? ["继续"] : []), ...(plan.rollback ? ["回退"] : [])].join("、") || "需人工处理"}`)
            if (options.scan || !plan.continue && !plan.rollback) return
            if (!input.interactive) throw new Error("需要交互选择恢复动作")
            const action = await select({ ...terminal.prompt, message: "选择恢复动作", options: [...(plan.continue ? [{ label: "继续完成", value: "continue" }] : []), ...(plan.rollback ? [{ label: "回退", value: "rollback" }] : []), { label: "取消", value: "cancel" }] })
            if (isCancel(action) || action === "cancel") return terminal.reporter.cancelled("已取消恢复")
            if (!await ask("确认执行事务恢复？")) return terminal.reporter.cancelled("已取消恢复")
            await recovery.apply(id, action === "rollback")
            terminal.reporter.outro("事务恢复完成")
        })
    }
    registerRecovery(program, false)
    registerRecovery(storage, true)
}
