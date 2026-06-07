import type {ManagedItem} from "./ManagedItem.ts"

export class ManagedItemRegistry {
    constructor(private readonly items: readonly ManagedItem[]) {}

    getAll(): readonly ManagedItem[] {
        return this.items
    }

    getById(id: string): ManagedItem | undefined {
        return this.items.find((item) => item.id === id)
    }
}