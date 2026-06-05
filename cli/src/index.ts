#!/usr/bin/env node
import { Command } from "commander"
import {cliCompatibility, cliDescription, cliName, cliVersion} from "./CliMetadata.ts"
import { createCliServices } from "./services.ts"
import { registerAdoptCommand } from "./command/adopt.ts"
import { registerBuildCommand } from "./command/build.ts"
import { registerCreateCommand } from "./command/create.ts"
import { registerDevCommand } from "./command/dev.ts"
import { registerPackageCommand } from "./command/package.ts"
import { registerSyncCommand } from "./command/sync.ts"

const cli = new Command()
const services = createCliServices()

cli.name(cliName).description(cliDescription).version(cliVersion)

registerCreateCommand(cli, services)
registerAdoptCommand(cli, services)
registerSyncCommand(cli, services)
registerDevCommand(cli, services)
registerBuildCommand(cli, services)
registerPackageCommand(cli, services)

await cli.parseAsync(process.argv)
