import type { FrameworkRegistryClient } from "../framework/FrameworkRegistryClient.ts"
import type { ProjectInteraction, ProjectInteractionInput } from "../project/ProjectInteraction.ts"
import type { InitializationPlan } from "../project/ProjectInitializer.ts"
import type { ConfigRegistry } from "../config/ConfigRegistry.ts"
import { runCreateWizard } from "./Create.ts"
import { runAdoptWizard } from "./Adopt.ts"
import { confirmInitialization, confirmPrompt } from "./Project.ts"

export class TerminalProjectInteraction implements ProjectInteraction {
    constructor(private readonly registry: FrameworkRegistryClient, private readonly config: ConfigRegistry) { }

    create(input: ProjectInteractionInput) { return runCreateWizard(this.registry, this.config, input) }
    adopt(input: ProjectInteractionInput) { return runAdoptWizard(this.registry, this.config, input) }
    confirmInitialization(plan: InitializationPlan, verb: string) { return confirmInitialization(plan, verb) }
    confirm(message: string) { return confirmPrompt(message) }
    message(message: string): void { console.log("[ArrangeCLI]", message) }
    failure(message: string): void { console.error("[ArrangeCLI]", message) }
}
