#!/usr/bin/env node
import { Command } from "commander"
import { cliDescription, cliName, cliVersion } from "./CliMetadata.ts"
import { ProjectStateStore } from "./project/ProjectStateStore.ts"
import { FrameworkRegistryClient } from "./framework/FrameworkRegistryClient.ts"
import { SyncService } from "./sync/SyncService.ts"
import { registerAdoptCommand } from "./command/Adopt.ts"
import { registerBuildCommand } from "./command/Build.ts"
import { registerCreateCommand } from "./command/Create.ts"
import { registerDevCommand } from "./command/Dev.ts"
import { registerPackageCommand } from "./command/Package.ts"
import { registerSyncCommand } from "./command/Sync.ts"

const store = new ProjectStateStore()
const registry = new FrameworkRegistryClient()
const cli = new Command()
const syncService = new SyncService(store, registry)

cli.name(cliName).description(cliDescription).version(cliVersion)

registerCreateCommand(cli, store, registry)
registerAdoptCommand(cli)
registerSyncCommand(cli, syncService)
registerDevCommand(cli)
registerBuildCommand(cli)
registerPackageCommand(cli)

await cli.parseAsync(process.argv)