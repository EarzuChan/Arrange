#!/usr/bin/env node
import { Command } from "commander"
import pkg from "../package.json" with { type: "json" }
import { createCliServices } from "./services.ts"
import { registerAdoptCommand } from "./command/adopt.ts"
import { registerBuildCommand } from "./command/build.ts"
import { registerCreateCommand } from "./command/create.ts"
import { registerDevCommand } from "./command/dev.ts"
import { registerPackageCommand } from "./command/package.ts"
import { registerSyncCommand } from "./command/sync.ts"

const cli = new Command()
const services = createCliServices()

export const cliName = "Arrange"
export const cliVersion = pkg.version
export const cliCompatibility = pkg.compatibility


cli.name(cliName).description(pkg.description).version(cliVersion)

registerCreateCommand(cli, services)
registerAdoptCommand(cli, services)
registerSyncCommand(cli, services)
registerDevCommand(cli, services)
registerBuildCommand(cli, services)
registerPackageCommand(cli, services)

await cli.parseAsync(process.argv)
