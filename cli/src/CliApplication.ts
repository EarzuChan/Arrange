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
}

export function createCliApplication(options: CliApplicationOptions): Command {
    const { terminal } = options
    const executor = new Executor(process.platform, options.signal)
    const platform = createPlatformService(executor)
    const fileWriter = new FileTransaction(options.signal)
    const store = new ProjectStateStore(fileWriter)
    const registry = new FrameworkRegistryClient(options.signal)
    const interactions = options.interactions === "terminal" ? { project: new TerminalProjectInteraction(registry, configRegistry, terminal), config: new SyncWizard(terminal), setup: new SetupWizard(terminal) } : options.interactions
    const scanner = new ConfigScanner(configRegistry)
    const writer = new ConfigWriter(options.signal)
    const resolver = new ConfigResolver(writer, interactions.config, options.signal)
    const applier = new ConfigApplier(writer)
    const tools = new ToolchainService(executor, platform)
    const framework = new FrameworkService(registry)
    const configuration = new ConfigurationReadiness(scanner, interactions.config)
    const project = new ProjectService(store, framework, configuration)
    const node = new NodeJsService(executor)
    const cmake = new CmakeService(executor, platform, new IconAssetsService(options.signal))
    const setup = new SetupService(store, tools, node, cmake, framework, interactions.setup, terminal.tasks, options.signal, new FrameworkSourceProbe(executor))
    const sync = new SyncService(store, framework, scanner, resolver, applier, setup, interactions.config, options.signal, terminal.tasks)
    const initializer = new ProjectInitializer(fileWriter, options.signal)
    const native = new NativeBuildService(cmake)
    const artifacts = new ArtifactLocator(cmake)
    const packer = new Packer(artifacts, executor, options.signal)
    const ui = new UiBuildService(node)
    const builder = new BuildService(project, tools, ui, native, packer, terminal.tasks)
    const dev = new DevService(project, tools, node, cmake, native, artifacts, new DevSupervisor(executor), ui, packer, terminal.tasks)
    const cli = new Command().name(cliName).description(cliDescription).version(cliVersion)
    const { reporter } = terminal
    registerCreateCommand(cli, initializer, sync, interactions.project, reporter)
    registerAdoptCommand(cli, initializer, sync, interactions.project, reporter)
    registerSyncCommand(cli, sync, reporter)
    registerDevCommand(cli, dev, options.signal, reporter)
    registerBuildCommand(cli, builder, reporter)
    registerPackCommand(cli, project, packer, terminal.tasks, reporter)
    return cli
}
