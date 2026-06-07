import {createCmakeManagedItems} from "../cmake/CmakeManagedItems.ts"
import {createCmakeTextClusters} from "../cmake/CmakeClusters.ts"
import {createNodeManagedItems} from "../node/NodeManagedItems.ts"
import {createNodeTextClusters} from "../node/NpmrcArrangeRegistryCluster.ts"
import {ManagedItemRegistry} from "./ManagedItemRegistry.ts"
import {TextClusterRegistry} from "./TextCluster.ts"

export function createDefaultManagedItemRegistry(): ManagedItemRegistry {
    return new ManagedItemRegistry([
        ...createNodeManagedItems(),
        ...createCmakeManagedItems(),
    ])
}

export function createDefaultTextClusterRegistry(): TextClusterRegistry {
    return new TextClusterRegistry([
        ...createNodeTextClusters(),
        ...createCmakeTextClusters(),
    ])
}
