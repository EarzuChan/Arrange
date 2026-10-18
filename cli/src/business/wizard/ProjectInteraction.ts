import type { FrameworkRegistryClient } from "../../feature/framework/FrameworkRegistryClient.ts"
import type { ProjectInteraction, ProjectInteractionInput } from "../../feature/project/ProjectInteraction.ts"
import type { InitializationPlan } from "../../feature/project/ProjectInitializer.ts"
import type { ConfigRegistry } from "../../feature/config/ConfigRegistry.ts"
import type { CommandInterface } from "../CommandInterface.ts"
import { runCreateWizard } from "./Create.ts"
import { runAdoptWizard } from "./Adopt.ts"
import { confirmInitialization, confirmPrompt } from "./Project.ts"

export class TerminalProjectInteraction implements ProjectInteraction {
    constructor(private readonly registry: FrameworkRegistryClient, private readonly config: ConfigRegistry, private readonly output: CommandInterface) { }

    create(input: ProjectInteractionInput) { return runCreateWizard(this.output, this.registry, this.config, input) }
    adopt(input: ProjectInteractionInput) { return runAdoptWizard(this.output, this.registry, this.config, input) }
    confirmInitialization(plan: InitializationPlan, verb: string) { return confirmInitialization(this.output, plan, verb) }
    confirm(message: string) { return confirmPrompt(this.output, message) }
    message(message: string): void { this.output.reporter.step(message) }
    failure(message: string): void { this.output.reporter.error(message) }
}
