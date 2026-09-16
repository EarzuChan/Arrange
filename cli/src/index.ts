#!/usr/bin/env node
import { Command } from "commander"
import {cliDescription, cliName, cliVersion} from "./CliMetadata.ts"
import { createServiceHub } from "./ServiceHub.ts"
import { registerAdoptCommand } from "./command/adopt.ts"
import { registerBuildCommand } from "./command/build.ts"
import { registerCreateCommand } from "./command/create.ts"
import { registerDevCommand } from "./command/dev.ts"
import { registerPackageCommand } from "./command/package.ts"
import { registerSyncCommand } from "./command/sync.ts"

const cli = new Command()
const serviceHub = createServiceHub()

cli.name(cliName).description(cliDescription).version(cliVersion)

registerCreateCommand(cli, serviceHub)
registerAdoptCommand(cli, serviceHub)
registerSyncCommand(cli, serviceHub)
registerDevCommand(cli, serviceHub)
registerBuildCommand(cli, serviceHub)
registerPackageCommand(cli, serviceHub)

await cli.parseAsync(process.argv)