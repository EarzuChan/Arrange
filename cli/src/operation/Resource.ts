import { realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

export type ResourceKind = "initialization" | "configuration" | "directory" | "source" | "endpoint"
export interface Resource { readonly kind: ResourceKind, readonly path: string, readonly mode: "read" | "write" }

export async function canonicalResource(resource: Resource): Promise<Resource> {
    if (resource.kind === "endpoint") return { ...resource, path: resource.path.toLowerCase() }
    let ancestor = resolve(resource.path)
    while (true) {
        try {
            const path = resolve(await realpath(ancestor), relative(ancestor, resolve(resource.path)))
            return { ...resource, path: process.platform === "win32" ? path.toLowerCase() : path }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            const parent = dirname(ancestor)
            if (parent === ancestor) throw error
            ancestor = parent
        }
    }
}

function contains(parent: string, child: string): boolean {
    const part = relative(parent, child)
    return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
}

export function resourcesConflict(first: Resource, second: Resource): boolean {
    if (first.mode === "read" && second.mode === "read") return false
    if (first.kind !== second.kind && first.kind !== "initialization" && second.kind !== "initialization") return false
    if (first.kind === "endpoint" || second.kind === "endpoint") return first.kind === second.kind && first.path === second.path
    return contains(first.path, second.path) || contains(second.path, first.path)
}

export function resourceCovers(held: Resource, requested: Resource): boolean {
    return held.kind === requested.kind && contains(held.path, requested.path) && (held.mode === "write" || requested.mode === "read")
}
