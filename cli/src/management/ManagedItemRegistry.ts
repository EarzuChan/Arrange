import type { ManagedItem } from "./ManagedItem.ts"

export class ManagedItemRegistry {
    private readonly items = new Map<string, ManagedItem>()

    register(item: ManagedItem): void {
        this.items.set(item.key, item)
    }

    get(key: string): ManagedItem | undefined {
        return this.items.get(key)
    }

    list(): ManagedItem[] {
        return [...this.items.values()]
    }
}
