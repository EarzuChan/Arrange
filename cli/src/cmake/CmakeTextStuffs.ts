import {resolve} from "node:path"
import {TextFile} from "../managed/ManagedFile.ts"
import {TextCluster} from "../managed/TextCluster.ts"
import {TextRegion} from "../managed/TextRegion.ts"
import {managedItemIds} from "../managed/ManagedItem.ts"
import type {ProjectState} from "../project/ProjectState.ts"

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/;/g, "\\;")}"`
const defaultFetchUrl = "https://github.com/EarzuChan/Arrange.git"

export class FetchContentRepositoryRegion extends TextRegion {
    readonly id = "cmake.fetch-content-repository"
    readonly managedItemId = managedItemIds.fetchContentRepository

    protected override makeInner(state: ProjectState): string {
        const url = state.project.framework.cmakeFetchContentUrl ?? defaultFetchUrl
        return `    GIT_REPOSITORY ${quote(url)}\n`
    }
}

export class FrameworkVersionRegion extends TextRegion {
    readonly id = "cmake.framework-version"
    readonly managedItemId = managedItemIds.frameworkVersion

    protected override makeInner(state: ProjectState): string {
        return `    GIT_TAG ${quote(`v${state.project.framework.version}`)}\n`
    }
}

export class PluginVersionRegion extends TextRegion {
    readonly id = "cmake.plugin-version"
    readonly managedItemId = managedItemIds.pluginVersion

    protected override makeInner(state: ProjectState): string {
        return `    VERSION ${quote(state.project.project.version)}\n`
    }
}

export class PluginIdentityRegion extends TextRegion {
    readonly id = "cmake.plugin-identity"
    readonly managedItemId = managedItemIds.pluginIdentity

    protected override makeInner(state: ProjectState): string {
        const project = state.project.project
        return `    COMPANY_NAME ${quote(project.vendorName)}
    PLUGIN_MANUFACTURER_CODE ${project.vendorCode}
    PLUGIN_CODE ${project.pluginCode}
`
    }
}

export class PluginFormatsRegion extends TextRegion {
    readonly id = "cmake.plugin-formats"
    readonly managedItemId = managedItemIds.pluginFormats

    protected override makeInner(state: ProjectState): string {
        const formats = state.project.project.products.map(product => product === "standalone" ? "Standalone" : "VST3")
        return `    FORMATS ${formats.join(" ")}\n`
    }
}

export class ProductNameRegion extends TextRegion {
    readonly id = "cmake.product-name"
    readonly managedItemId = managedItemIds.projectName

    protected override makeInner(state: ProjectState): string {
        return `    PRODUCT_NAME ${quote(state.project.project.name)}\n`
    }
}

export class FetchContentCluster extends TextCluster {
    readonly id = "cmake.fetch-content"
    readonly repositoryRegion = new FetchContentRepositoryRegion()
    readonly versionRegion = new FrameworkVersionRegion()
    readonly regions = [this.repositoryRegion, this.versionRegion]

    protected override makeInner(state: ProjectState): string {
        return `include(FetchContent)
FetchContent_Declare(arrange
${this.repositoryRegion.make(state)}${this.versionRegion.make(state)})
FetchContent_MakeAvailable(arrange)
`
    }
}

export class JucePluginCluster extends TextCluster {
    readonly id = "cmake.juce-plugin"
    readonly versionRegion = new PluginVersionRegion()
    readonly identityRegion = new PluginIdentityRegion()
    readonly formatsRegion = new PluginFormatsRegion()
    readonly productNameRegion = new ProductNameRegion()
    readonly regions = [this.versionRegion, this.identityRegion, this.formatsRegion, this.productNameRegion]

    protected override makeInner(state: ProjectState): string {
        const regions = this.regions.map(region => region.make(state)).join("")
        const isSynth = state.project.native.pluginType === "instrument" ? "TRUE" : "FALSE"

        return `juce_add_plugin(${state.project.project.name}
${regions}    IS_SYNTH ${isSynth}
    NEEDS_MIDI_INPUT ${isSynth}
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
)
`
    }
}

export class CmakeListsFile extends TextFile {
    readonly id = "cmake-lists"
    readonly scope = "Native"
    readonly fetchContentCluster = new FetchContentCluster()
    readonly jucePluginCluster = new JucePluginCluster()
    readonly clusters = [this.fetchContentCluster, this.jucePluginCluster]

    override path(state: ProjectState): string {
        return resolve(state.rootDir, state.project.native.directory, "CMakeLists.txt")
    }

    override make(state: ProjectState): string {
        const name = state.project.project.name
        const fetchContent = this.fetchContentCluster.make(state)
        const plugin = this.jucePluginCluster.make(state)
        return `cmake_minimum_required(VERSION 3.24)
project(${name} LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

${fetchContent}
${plugin}
juce_generate_juce_header(${name})
target_sources(${name} PRIVATE Source/${name}Processor.cpp)
target_compile_definitions(${name} PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_compile_definitions(${name} PUBLIC JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(${name} PRIVATE
    Arrange::framework
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
`
    }
}

export const cmakeListsFile = new CmakeListsFile()
export const fetchContentCluster = cmakeListsFile.fetchContentCluster
export const jucePluginCluster = cmakeListsFile.jucePluginCluster
export const fetchContentRepositoryRegion = fetchContentCluster.repositoryRegion
export const frameworkVersionRegion = fetchContentCluster.versionRegion
export const pluginVersionRegion = jucePluginCluster.versionRegion
export const pluginIdentityRegion = jucePluginCluster.identityRegion
export const pluginFormatsRegion = jucePluginCluster.formatsRegion
export const productNameRegion = jucePluginCluster.productNameRegion
