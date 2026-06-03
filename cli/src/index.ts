import {Command} from "commander"
import pkg from '../package.json' with { type: 'json' }
import {registerCreateCommand} from "./commands/create.ts";

const program = new Command()

// 命令注册
registerCreateCommand(program)

program.name('Arrange CLI').description(pkg.description).version(pkg.version)