import type {TextManagedItem} from "../managed/ManagedItem.ts"
import {CmakeFetchContentRegion, CmakePluginFormatsRegion, CmakePluginIdentityRegion, CmakePluginVersionRegion, CmakeProductNameRegion} from "./TextRegions.ts"

export class CmakeFetchContentItem implements TextManagedItem {
    static readonly key = CmakeFetchContentRegion.key

    readonly id = CmakeFetchContentItem.key
    readonly kind = "text"

    resolveRegions() {
        return [new CmakeFetchContentRegion()]
    }
}

export class CmakePluginFormatsItem implements TextManagedItem {
    static readonly key = CmakePluginFormatsRegion.key

    readonly id = CmakePluginFormatsItem.key
    readonly kind = "text"

    resolveRegions() {
        return [new CmakePluginFormatsRegion()]
    }
}

export class CmakePluginVersionItem implements TextManagedItem {
    static readonly key = CmakePluginVersionRegion.key

    readonly id = CmakePluginVersionItem.key
    readonly kind = "text"

    resolveRegions() {
        return [new CmakePluginVersionRegion()]
    }
}

export class CmakePluginIdentityItem implements TextManagedItem {
    static readonly key = CmakePluginIdentityRegion.key

    readonly id = CmakePluginIdentityItem.key
    readonly kind = "text"

    resolveRegions() {
        return [new CmakePluginIdentityRegion()]
    }
}

export class CmakeProductNameItem implements TextManagedItem {
    static readonly key = CmakeProductNameRegion.key

    readonly id = CmakeProductNameItem.key
    readonly kind = "text"

    resolveRegions() {
        return [new CmakeProductNameRegion()]
    }
}

export function createCmakeManagedItems(): readonly TextManagedItem[] {
    return [
        new CmakeFetchContentItem(),
        new CmakePluginFormatsItem(),
        new CmakePluginVersionItem(),
        new CmakePluginIdentityItem(),
        new CmakeProductNameItem(),
    ]
}

// TODO：NAME Item（with its 6 regions）