import { cliDescription, cliName, cliVersion } from "./CliMetadata.ts"

import type { CommandInterface } from "./business/CommandInterface.ts"
import { ApplicationCommand } from "./business/ApplicationCommand.ts"
import { ApplicationOperations } from "./business/ApplicationOperations.ts"
import { ScanPresentation } from './business/ScanPresentation.ts'
import { registerAdoptCommand } from "./business/command/Adopt.ts"
import { registerBuildCommand } from "./business/command/Build.ts"
import { registerCreateCommand } from "./business/command/Create.ts"
import { registerDevCommand } from "./business/command/Dev.ts"
import { registerMaintenanceCommands } from "./business/command/Maintenance.ts"
import { registerPackCommand } from "./business/command/Pack.ts"
import { registerSyncCommand } from "./business/command/Sync.ts"
import { SetupWizard } from "./business/wizard/Setup.ts"
import { SyncWizard } from "./business/wizard/Sync.ts"
import { TerminalProjectInteraction } from "./business/wizard/ProjectInteraction.ts"

import { configRegistry } from "./feature/config/ConfigRegistry.ts"
import { IconAssetsService } from "./feature/asset/IconAssetsService.ts"
import { BuildService } from "./feature/building/BuildService.ts"
import { DevService } from "./feature/building/DevService.ts"
import { NativeBuildService } from "./feature/building/NativeBuildService.ts"
import { UiBuildService } from "./feature/building/UiBuildService.ts"
import { CmakeService } from "./feature/cmake/CmakeService.ts"
import { ConfigApplier } from "./feature/sync/ConfigApplier.ts"
import type { ConfigInteraction } from "./feature/sync/ConfigInteraction.ts"
import { ConfigResolver } from "./feature/sync/ConfigResolver.ts"
import { ConfigScanner } from "./feature/sync/ConfigScanner.ts"
import { ConfigWriter } from "./feature/sync/ConfigWriter.ts"
import { ConfigurationReadiness } from "./feature/sync/ConfigurationReadiness.ts"
import { DevSupervisor } from "./feature/platform/DevSupervisor.ts"
import { Executor } from "./feature/platform/Executor.ts"
import { ToolchainService } from "./feature/platform/ToolchainService.ts"
import { createPlatformService } from "./feature/platform/CreatePlatformService.ts"
import { FrameworkRegistryClient } from "./feature/framework/FrameworkRegistryClient.ts"
import { FrameworkService } from "./feature/framework/FrameworkService.ts"
import { FrameworkSourceProbe } from "./feature/framework/FrameworkSourceProbe.ts"
import { ArtifactLocator } from "./feature/packing/ArtifactLocator.ts"
import { Packer } from "./feature/packing/Packer.ts"
import { NativeSourceService } from "./feature/source/NativeSourceService.ts"
import { SourceCache } from "./feature/source/SourceCache.ts"
import { GitSource } from "./feature/source/GitSource.ts"
import { NodeJsService } from "./feature/nodejs/NodeJsService.ts"
import { FileTransaction } from "./feature/transaction/FileTransaction.ts"
import { OperationHost } from "./feature/operation/OperationHost.ts"
import { Operations } from "./feature/operation/Operations.ts"
import { ProjectOperations } from "./feature/operation/ProjectOperations.ts"
import type { ProjectInteraction } from "./feature/project/ProjectInteraction.ts"
import { ProjectInitializer } from "./feature/project/ProjectInitializer.ts"
import { ProjectService } from "./feature/project/ProjectService.ts"
import { ProjectStateStore } from "./feature/project/ProjectStateStore.ts"
import { ProjectRegistry } from "./feature/user/ProjectRegistry.ts"
import { UserDirectories } from "./feature/user/UserDirectories.ts"
import { SetupService } from "./feature/sync/SetupService.ts"
import { SyncService } from "./feature/sync/SyncService.ts"
import type { SetupInteraction } from "./feature/sync/SetupInteraction.ts"
import { StorageInventory } from "./feature/storage/StorageInventory.ts"
import { StorageMaintenance } from "./feature/storage/StorageMaintenance.ts"
import { ProjectCleaner } from "./feature/storage/ProjectCleaner.ts"

export interface CliInteractions {
    readonly project: ProjectInteraction
    readonly config: ConfigInteraction
    readonly setup: SetupInteraction
}

export interface CliApplicationOptions {
    readonly signal: AbortSignal
    readonly interactions: CliInteractions | "terminal"
    // 持久消息与实时任务的输出终端，由入口创建
    readonly terminal: CommandInterface
    readonly userDirectories?: UserDirectories
}

export function createCliApplication(options: CliApplicationOptions): ApplicationCommand {
    const { terminal } = options
    const directories = options.userDirectories ?? new UserDirectories()

    const host = new OperationHost(directories)
    const signal = AbortSignal.any([options.signal, host.failureSignal])
    const operations = new Operations(host, signal, message => terminal.reporter.info(message))
    const executor = new Executor(process.platform, signal, host)
    const platform = createPlatformService(executor)

    const fileWriter = new FileTransaction(signal)
    const store = new ProjectStateStore(fileWriter)
    const registry = new FrameworkRegistryClient(signal)
    const sourceGit = new GitSource(executor)
    const sourceCache = new SourceCache(directories, sourceGit, signal, operations)
    const sources = new NativeSourceService(sourceCache)
    const framework = new FrameworkService(registry, { git: sourceGit, cache: sourceCache, operations, directory: directories.dependencySources })

    const scans = { config: new ScanPresentation(terminal), setup: new ScanPresentation(terminal) }
    const interactions = options.interactions === "terminal" ? { project: new TerminalProjectInteraction(framework, configRegistry, terminal), config: new SyncWizard(terminal, scans.config), setup: new SetupWizard(terminal, scans.setup) } : options.interactions

    const scanner = new ConfigScanner(configRegistry)
    const writer = new ConfigWriter(signal)
    const resolver = new ConfigResolver(writer, interactions.config, signal)
    const applier = new ConfigApplier(writer)
    const tools = new ToolchainService(executor, platform)
    const configuration = new ConfigurationReadiness(scanner, interactions.config)
    const project = new ProjectService(store, framework, configuration)

    const node = new NodeJsService(executor)
    const cmake = new CmakeService(executor, platform, new IconAssetsService(signal), directories, sources, signal)
    const projectRegistry = new ProjectRegistry(directories, signal)
    const lifetime = { kind: "directory" as const, path: directories.dependencySources, mode: "read" as const }
    const projectOperations = new ProjectOperations(operations, store, cmake, projectRegistry, lifetime)

    const setup = new SetupService(store, tools, node, cmake, framework, interactions.setup, options.interactions === 'terminal' ? scans.setup : terminal.tasks, signal, new FrameworkSourceProbe(executor, undefined, sources), (state, scope) => projectOperations.assertSetup(state, scope))
    const sync = new SyncService(store, framework, scanner, resolver, applier, setup, interactions.config, signal, options.interactions === 'terminal' ? scans.config : terminal.tasks)

    const initializer = new ProjectInitializer(fileWriter, signal)
    const native = new NativeBuildService(cmake)
    const artifacts = new ArtifactLocator(cmake)
    const packer = new Packer(artifacts, executor, signal)
    const ui = new UiBuildService(node)
    const builder = new BuildService(project, tools, ui, native, packer, terminal.tasks)
    const dev = new DevService(project, tools, node, cmake, native, artifacts, new DevSupervisor(executor), ui, packer, sources, terminal.tasks)
    const actions = new ApplicationOperations(operations, projectOperations, projectRegistry)

    const cli = new ApplicationCommand(host).exitOverride()/*这是AppCmd自己的Exit覆写*/.name(cliName).description(cliDescription).version(cliVersion)
    cli.configureOutput({ writeOut: text => terminal.reporter.info(text), writeErr: text => terminal.reporter.error(text) })
    const { reporter } = terminal

    const protectedInitializer = { planCreate: initializer.planCreate.bind(initializer), planAdopt: initializer.planAdopt.bind(initializer), apply: (plan: Parameters<ProjectInitializer["apply"]>[0]) => actions.initialize(initializer, plan) }
    const protectedSync = { run: (options: Parameters<SyncService["run"]>[0], root: string) => actions.sync(sync, options, root) }

    registerCreateCommand(cli, protectedInitializer, protectedSync, interactions.project, reporter)
    registerAdoptCommand(cli, protectedInitializer, protectedSync, interactions.project, reporter)
    registerSyncCommand(cli, protectedSync, reporter)
    registerDevCommand(cli, { run: (root, options) => actions.dev(dev, root, options) }, signal, terminal)
    registerBuildCommand(cli, { build: (root, options) => actions.build(builder, root, options) }, reporter)
    registerPackCommand(cli, (root, options) => actions.pack(project, packer, root, options), terminal.tasks, reporter)

    const storageGit = new GitSource(executor)
    const inventory = new StorageInventory(directories, projectRegistry, storageGit, signal, store, cmake)
    registerMaintenanceCommands(cli, { terminal, store, projects: projectOperations, operations, directories, registry: projectRegistry, inventory, cleaner: new ProjectCleaner(cmake, signal), maintenance: new StorageMaintenance(directories, inventory, storageGit, signal, projectRegistry), lifetime, signal, interactive: options.interactions === "terminal" })

    cli.exitOverride() // 确保子命令都覆写退出
    return cli
}
