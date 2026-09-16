import {resolve} from "node:path"
import {TextFile, JsonFile} from "../managed/ManagedFile.ts"
import {TextCluster} from "../managed/TextCluster.ts"
import {TextRegion} from "../managed/TextRegion.ts"
import {JsonRegion} from "../managed/JsonRegion.ts"
import {managedItemIds} from "../managed/ManagedItem.ts"

export const registryRegion = new TextRegion("node.registry", managedItemIds.registry, state => state.project.framework.nodeRegistryUrl == null ? "" : `@arrange:registry=${state.project.framework.nodeRegistryUrl}\n`)
export const registryCluster = new TextCluster("node.registry", [registryRegion], state => registryRegion.make(state))
export const npmrcFile = new TextFile("npmrc", "UI", state => resolve(state.rootDir, state.project.ui.directory, ".npmrc"), [registryCluster], state => registryCluster.make(state))
export const packageNameRegion = new JsonRegion("node.package-name", managedItemIds.projectName, ["name"], state => state.project.project.name.toLowerCase())
export const frameworkDependencyRegion = new JsonRegion("node.framework-dependency", managedItemIds.frameworkVersion, ["dependencies", "@arrange/framework"], state => state.project.framework.version)
export const packageJsonFile = new JsonFile("package-json", "UI", state => resolve(state.rootDir, state.project.ui.directory, "package.json"), [packageNameRegion, frameworkDependencyRegion], () => ({private: true, type: "module", scripts: {dev: "vite", build: "vite build"}}))
