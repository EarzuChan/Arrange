import { Command } from 'commander'

// 这只是一个模板
export function registerCreateCommand(program: Command) {
    program.command('create').description('Create a new project').action(async (options) => {
        // 基本不要把具体业务代码写在Command中
        // 也不要让复杂的交互在Command中，应在Wizard中进行专项的交互
    })
}