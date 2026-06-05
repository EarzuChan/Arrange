import type { ProjectContext } from "../project/ProjectContext.ts"
import type { ManagedItemCheckResult } from "./ManagedItem.ts"
import { ManagedItemRegistry } from "./ManagedItemRegistry.ts"

export class ConfigurationService {
    constructor(private readonly registry = new ManagedItemRegistry()) {}

    async checkManagedItems(context: ProjectContext): Promise<ManagedItemCheckResult[]> {
        const results: ManagedItemCheckResult[] = []

        for (const item of this.registry.list()) {
            const policy = context.state.project.managed.items[item.key]

            if (!policy?.managed) {
                results.push({ key: item.key, status: "disabled" })
                continue
            }

            results.push(await item.check(context))
        }
        return results
    }

    getRegistry(): ManagedItemRegistry {
        return this.registry
    }
}
