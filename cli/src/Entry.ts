#!/usr/bin/env node
import { Command } from "commander"
import {cliDescription, cliName, cliVersion} from "./CliMetadata.ts"
import { serviceHub } from "./ServiceHub.ts"
import { registerAdoptCommand } from "./command/Adopt.ts"
import { registerBuildCommand } from "./command/Build.ts"
import { registerCreateCommand } from "./command/Create.ts"
import { registerDevCommand } from "./command/Dev.ts"
import { registerPackageCommand } from "./command/Package.ts"
import { registerSyncCommand } from "./command/Sync.ts"

const cli = new Command()

cli.name(cliName).description(cliDescription).version(cliVersion)

registerCreateCommand(cli, serviceHub)
registerAdoptCommand(cli, serviceHub)
registerSyncCommand(cli, serviceHub)
registerDevCommand(cli, serviceHub)
registerBuildCommand(cli, serviceHub)
registerPackageCommand(cli, serviceHub)

await cli.parseAsync(process.argv)
