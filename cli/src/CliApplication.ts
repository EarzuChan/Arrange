import { Command } from "commander"
import { cliDescription, cliName, cliVersion } from "./CliMetadata.ts"
import { ProjectStateStore } from "./project/ProjectStateStore.ts"
import { FrameworkRegistryClient } from "./framework/FrameworkRegistryClient.ts"
import { SyncService } from "./sync/SyncService.ts"
import { SetupService } from "./sync/SetupService.ts"
import { FrameworkService } from "./framework/FrameworkService.ts"
import { FrameworkSourceProbe } from "./framework/FrameworkSourceProbe.ts"
import { ConfigurationReadiness } from "./sync/ConfigurationReadiness.ts"
import { ConfigScanner } from "./sync/ConfigScanner.ts"
import { ConfigResolver } from "./sync/ConfigResolver.ts"
import { ConfigApplier } from "./sync/ConfigApplier.ts"
import { ConfigWriter } from "./sync/ConfigWriter.ts"
import { configRegistry } from "./config/ConfigRegistry.ts"
import { ProjectService } from "./project/ProjectService.ts"
import { ProjectInitializer } from "./project/ProjectInitializer.ts"
import type { ProjectInteraction } from "./project/ProjectInteraction.ts"
import type { ConfigInteraction } from "./sync/ConfigInteraction.ts"
import type { SetupInteraction } from "./sync/SetupInteraction.ts"
import { SyncWizard } from "./wizard/Sync.ts"
import { SetupWizard } from "./wizard/Setup.ts"
import { TerminalProjectInteraction } from "./wizard/ProjectInteraction.ts"
import { Executor } from "./platform/Executor.ts"
import { createPlatformService } from "./platform/CreatePlatformService.ts"
import { ToolchainService } from "./platform/ToolchainService.ts"
import { DevSupervisor } from "./platform/DevSupervisor.ts"
import { CmakeService } from "./cmake/CmakeService.ts"
import { NodeJsService } from "./node-js/NodeJsService.ts"
import { UiBuildService } from "./building/UiBuildService.ts"
import { NativeBuildService } from "./building/NativeBuildService.ts"
import { BuildService } from "./building/BuildService.ts"
import { DevService } from "./building/DevService.ts"
import { ArtifactLocator } from "./packing/ArtifactLocator.ts"
import { Packer } from "./packing/Packer.ts"
import { registerAdoptCommand } from "./command/Adopt.ts"
import { registerBuildCommand } from "./command/Build.ts"
import { registerCreateCommand } from "./command/Create.ts"
import { registerDevCommand } from "./command/Dev.ts"
import { registerPackCommand } from "./command/Pack.ts"
import { registerSyncCommand } from "./command/Sync.ts"
import { FileTransaction } from "./util/FileTransaction.ts"
import { IconAssetsService } from "./asset/IconAssetsService.ts"
import type { CliTerminal } from "./ui/Terminal.ts"
import { UserDirectories } from "./user/UserDirectories.ts"
import { SourceCache } from "./source/SourceCache.ts"
import { GitSource } from "./source/GitSource.ts"
import { NativeSourceService } from "./source/NativeSourceService.ts"
import { OperationHost } from "./operation/OperationHost.ts"
import { Operations } from "./operation/Operations.ts"
import { ProjectOperations } from "./operation/ProjectOperations.ts"
import { ApplicationOperations } from "./operation/ApplicationOperations.ts"
import { ApplicationCommand } from "./operation/ApplicationCommand.ts"
import { ProjectRegistry } from "./user/ProjectRegistry.ts"
import { StorageInventory } from "./storage/StorageInventory.ts"
import { StorageMaintenance } from "./storage/StorageMaintenance.ts"
import { ProjectCleaner } from "./storage/ProjectCleaner.ts"
import { registerMaintenanceCommands } from "./command/Maintenance.ts"

export interface CliInteractions {
    readonly project: ProjectInteraction
    readonly config: ConfigInteraction
    readonly setup: SetupInteraction
}

export interface CliApplicationOptions {
    readonly signal: AbortSignal
    readonly interactions: CliInteractions | "terminal"
    // 持久消息与实时任务的输出终端，由入口创建
    readonly terminal: CliTerminal
    readonly userDirectories?: UserDirectories
}

export function createCliApplication(options: CliApplicationOptions): Command {
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
    const interactions = options.interactions === "terminal" ? { project: new TerminalProjectInteraction(registry, configRegistry, terminal), config: new SyncWizard(terminal), setup: new SetupWizard(terminal) } : options.interactions
    const scanner = new ConfigScanner(configRegistry)
    const writer = new ConfigWriter(signal)
    const resolver = new ConfigResolver(writer, interactions.config, signal)
    const applier = new ConfigApplier(writer)
    const tools = new ToolchainService(executor, platform)
    const framework = new FrameworkService(registry)
    const configuration = new ConfigurationReadiness(scanner, interactions.config)
    const project = new ProjectService(store, framework, configuration)
    const node = new NodeJsService(executor)
    const sources = new NativeSourceService(new SourceCache(directories, new GitSource(executor), signal, operations))
    const cmake = new CmakeService(executor, platform, new IconAssetsService(signal), directories, sources, signal)
    const projectRegistry = new ProjectRegistry(directories, signal)
    const lifetime = { kind: "directory" as const, path: directories.sources, mode: "read" as const }
    const projectOperations = new ProjectOperations(operations, store, cmake, projectRegistry, lifetime)
    const setup = new SetupService(store, tools, node, cmake, framework, interactions.setup, terminal.tasks, signal, new FrameworkSourceProbe(executor, undefined, sources), (state, scope) => projectOperations.assertSetup(state, scope))
    const sync = new SyncService(store, framework, scanner, resolver, applier, setup, interactions.config, signal, terminal.tasks)
    const initializer = new ProjectInitializer(fileWriter, signal)
    const native = new NativeBuildService(cmake)
    const artifacts = new ArtifactLocator(cmake)
    const packer = new Packer(artifacts, executor, signal)
    const ui = new UiBuildService(node)
    const builder = new BuildService(project, tools, ui, native, packer, terminal.tasks)
    const dev = new DevService(project, tools, node, cmake, native, artifacts, new DevSupervisor(executor), ui, packer, terminal.tasks)
    const actions = new ApplicationOperations(operations, projectOperations, projectRegistry)
    const cli = new ApplicationCommand(host).name(cliName).description(cliDescription).version(cliVersion)
    const { reporter } = terminal
    const protectedInitializer = { planCreate: initializer.planCreate.bind(initializer), planAdopt: initializer.planAdopt.bind(initializer), apply: (plan: Parameters<ProjectInitializer["apply"]>[0]) => actions.initialize(initializer, plan) }
    const protectedSync = { run: (options: Parameters<SyncService["run"]>[0], root: string) => actions.sync(sync, options, root) }
    registerCreateCommand(cli, protectedInitializer, protectedSync, interactions.project, reporter)
    registerAdoptCommand(cli, protectedInitializer, protectedSync, interactions.project, reporter)
    registerSyncCommand(cli, protectedSync, reporter)
    registerDevCommand(cli, { run: (root, options) => actions.dev(dev, root, options) }, signal, reporter)
    registerBuildCommand(cli, { build: (root, options) => actions.build(builder, root, options) }, reporter)
    registerPackCommand(cli, (root, options) => actions.pack(project, packer, root, options), terminal.tasks, reporter)
    const storageGit = new GitSource(executor)
    const inventory = new StorageInventory(directories, projectRegistry, storageGit, signal)
    registerMaintenanceCommands(cli, { terminal, store, projects: projectOperations, operations, directories, registry: projectRegistry, inventory, cleaner: new ProjectCleaner(cmake, signal), maintenance: new StorageMaintenance(directories, inventory, storageGit, signal, projectRegistry), lifetime, signal, interactive: options.interactions === "terminal" })
    return cli
}
