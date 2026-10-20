import type { ApplicationCommand } from "../ApplicationCommand.ts"
import { confirm, isCancel, multiselect, select } from "../../terminal/Prompts.ts"
import { dirname, resolve } from "node:path"
import type { CommandInterface } from "../CommandInterface.ts"
import type { ProjectStateStore } from "../../feature/project/ProjectStateStore.ts"
import type { ProjectOperations } from "../../feature/operation/ProjectOperations.ts"
import type { Operations } from "../../feature/operation/Operations.ts"
import type { Resource } from "../../feature/operation/Resource.ts"
import type { UserDirectories } from "../../feature/user/UserDirectories.ts"
import type { ProjectRegistry } from "../../feature/user/ProjectRegistry.ts"
import type { ProjectCleaner, CleanOptions } from "../../feature/storage/ProjectCleaner.ts"
import type { StorageInventory } from "../../feature/storage/StorageInventory.ts"
import type { StorageMaintenance } from "../../feature/storage/StorageMaintenance.ts"
import { RecoveryService } from "../../feature/transaction/RecoveryService.ts"
import { TransactionStore } from "../../feature/transaction/TransactionStore.ts"
import { treeIdentity } from "../../feature/transaction/TreeState.ts"
import { formatFileSize } from "../../util/FileSize.ts"
import { describeStorageItem, describeCleanupBlockers } from "../report/StorageReport.ts"
import type { StorageItem } from "../../feature/storage/StorageFacts.ts"
import type { InspectionFact } from "../../util/RecordInspection.ts"

interface Dependencies {
    readonly terminal: CommandInterface
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

export function registerMaintenanceCommands(program: ApplicationCommand, input: Dependencies): void {
    const { terminal, signal } = input
    const inspectStorage = async (): Promise<readonly StorageItem[]> => {
        const items = await input.inventory.inspect()
        const occupied = new Map<string, InspectionFact>()
        for (const item of items) if (item.kind !== "project") try {
            await input.operations.run([{ kind: "directory", path: item.path, mode: "read" }], "检查存储占用", async () => { }, true)
        } catch (error) {
            signal.throwIfAborted()
            occupied.set(item.id, { state: "unavailable", path: item.path, reason: error instanceof Error ? error.message : String(error) })
        }
        const blockedBuilds = items.flatMap(item => item.kind === "build" && occupied.has(item.id) ? [occupied.get(item.id)!] : [])
        return items.map(item => {
            const busy = occupied.get(item.id)
            const blocked = item.kind === "deps-src" && blockedBuilds.length > 0
            if (!busy && !blocked) return item
            return { ...item, facts: busy ? [...item.facts, { label: "occupancy" as const, check: busy }] : item.facts, references: blocked ? { ...item.references, complete: false, blockers: [...item.references.blockers, ...blockedBuilds] } : item.references, cleanup: { allowed: false, reason: busy ? "资源正在使用，无法稳定查看或清理" : "存在忙构建，无法完整确认引用" }, repairable: false }
        })
    }
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
            if (!plan.length || options.scan) return terminal.reporter.success(plan.length ? "清理计划已展示，未修改" : "没有可清理内容")
            const identities = await Promise.all(plan.map(entry => treeIdentity(entry.path)))
            if (!await ask("确认清理以上内容？")) return terminal.reporter.warn("已取消清理")
            await input.projects.run(root, { configuration: "write", ui: clean.ui ? "write" : undefined, native: clean.native ? "write" : undefined, artifacts: clean.artifacts ? "write" : undefined }, "arrange clean", async () => {
                const current = await input.store.load(root)
                const next = await input.cleaner.plan(current, clean)
                if (JSON.stringify(next) !== JSON.stringify(plan) || JSON.stringify(await Promise.all(next.map(entry => treeIdentity(entry.path)))) !== JSON.stringify(identities)) throw new Error("清理计划在确认后发生变化，请重新运行")
                await input.cleaner.execute(current, next)
            })
            terminal.reporter.success("工程清理完成")
        })
    const storage = program.command("storage").description("管理本用户 Arrange 存储")
    storage.command("inspect").description("查看工程登记与受管资源").action(async () => {
        const items = await inspectStorage()
        if (!items.length) return terminal.reporter.success("存储为空，没有内容")
        for (const item of items) terminal.reporter.info(describeStorageItem(item))
    })
    storage.command("clean").description("选择清理可释放的用户级资源").option("--scan", "只查看计划").action(async (options: { scan?: boolean }) => {
        const items = await inspectStorage()
        const candidates = items.filter(item => item.cleanup.allowed)
        for (const item of candidates) terminal.reporter.info(`${item.id} · ${item.sizeComplete ? "" : "至少 "}${formatFileSize(item.bytes)} · ${item.path}`)
        if (options.scan || !candidates.length) {
            for (const reason of describeCleanupBlockers(items)) terminal.reporter.info(`未列入候选：${reason}`)
            return terminal.reporter.success(candidates.length ? "候选及排除原因已展示，未修改" : items.length ? "没有可安全清理的候选，排除原因见上方" : "存储为空，没有内容")
        }
        if (!input.interactive) throw new Error("需要交互选择；请使用 --scan 查看计划")
        const selected = await multiselect({ ...terminal.prompt, message: "选择要释放的资源", required: false, options: candidates.map(item => ({ value: item.id, label: `${item.id} · ${item.path}` })) })
        if (isCancel(selected) || !selected.length) return terminal.reporter.warn("已取消清理")
        const selectedItems = candidates.filter(item => selected.includes(item.id))
        const identities = await Promise.all(selectedItems.map(item => treeIdentity(item.path)))
        if (!await ask("确认清理所选资源？")) return terminal.reporter.warn("已取消清理")
        await input.operations.run([{ ...input.lifetime, mode: "write" }, ...selectedItems.map(item => ({ kind: "directory" as const, path: item.path, mode: "write" as const }))], "arrange storage clean", async () => {
            if (JSON.stringify(identities) !== JSON.stringify(await Promise.all(selectedItems.map(item => treeIdentity(item.path))))) throw new Error("所选资源在确认后变化，请重新查看")
            await input.maintenance.clean(selectedItems)
        }, true)
        terminal.reporter.success("用户级清理完成")
    })
    storage.command("repair <id>").description("按确切 commit 修复依赖源码缓存").option("--scan", "只查看影响").action(async (id: string, options: { scan?: boolean }) => {
        const key = id.replace(/^deps-src:/, "")
        const item = (await inspectStorage()).find(item => item.id === `deps-src:${key}`)
        if (!item) throw new Error("未找到依赖源码条目")
        terminal.reporter.info(describeStorageItem(item))
        if (options.scan) return
        if (!item.repairable) throw new Error(`此依赖源码不能自动修复：${item.cleanup.reason}；请使用 storage inspect 查看具体原因`)
        if (!await ask("确认重新获取此源码快照，并使相关准备状态失效？")) return terminal.reporter.warn("已取消修复")
        await input.operations.run([{ ...input.lifetime, mode: "write" }, ...item.references.paths.map(path => ({ kind: "directory" as const, path, mode: "write" as const }))], "arrange storage repair", () => terminal.tasks.run({ id: "source-repair", title: "修复共享依赖源码" }, task => input.maintenance.repair(key, task)))
        terminal.reporter.success("依赖源码修复完成，请重新运行 native SETUP")
    })
    const registerRecovery = (command: ApplicationCommand, user: boolean): void => {
        command.command("recover [id]").description(user ? "恢复用户级维护事务" : "恢复当前工程事务").option("--scan", "只查看事务").action(async (id: string | undefined, options: { scan?: boolean }) => {
            const store = user ? new TransactionStore(input.directories.root, input.directories.transactions) : new TransactionStore(resolve(process.cwd()))
            const current = user ? undefined : (await input.store.deepLoad(store.root)).state
            const allowedRoots = user ? [input.directories.dependencySources, input.directories.projects, input.directories.builds] : [store.root]
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
            if (isCancel(action) || action === "cancel") return terminal.reporter.warn("已取消恢复")
            if (!await ask("确认执行事务恢复？")) return terminal.reporter.warn("已取消恢复")
            await recovery.apply(id, action === "rollback")
            terminal.reporter.success("事务恢复完成")
        })
    }
    registerRecovery(program, false)
    registerRecovery(storage, true)
}
