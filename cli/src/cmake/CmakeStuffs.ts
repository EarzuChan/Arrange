import {defaultFetchUrl} from "../CliMetadata.ts"
import {resolve} from "node:path"
import {TextFile} from "../managed/ManagedFile.ts"
import {TextCluster} from "../managed/TextCluster.ts"
import {TextRegion} from "../managed/TextRegion.ts"
import type {ProjectState} from "../project/ProjectState.ts"

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/;/g, "\\;")}"`

export const fetchContentRepositoryRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.fetch-content-repository"
    readonly managedItemId = "cmake.fetch-content-repository"

    protected override makeInner(state: ProjectState): string {
        const url = state.project.framework.cmakeFetchContentUrl ?? defaultFetchUrl
        return `    GIT_REPOSITORY ${quote(url)}\n`
    }
}()

export const frameworkVersionRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.framework-version"
    readonly managedItemId = "framework.version"

    protected override makeInner(state: ProjectState): string {
        return `    GIT_TAG ${quote(`v${state.project.framework.version}`)}\n`
    }
}()

export const pluginVersionRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.plugin-version"
    readonly managedItemId = "cmake.plugin-version"

    protected override makeInner(state: ProjectState): string {
        return `    VERSION ${quote(state.project.project.version)}\n`
    }
}()

export const pluginIdentityRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.plugin-identity"
    readonly managedItemId = "cmake.plugin-identity"

    protected override makeInner(state: ProjectState): string {
        const project = state.project.project
        return `    COMPANY_NAME ${quote(project.vendorName)}
    PLUGIN_MANUFACTURER_CODE ${project.vendorCode}
    PLUGIN_CODE ${project.pluginCode}
`
    }
}()

export const pluginFormatsRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.plugin-formats"
    readonly managedItemId = "cmake.plugin-formats"

    protected override makeInner(state: ProjectState): string {
        const formats = state.project.project.products.map(product => product === "standalone" ? "Standalone" : "VST3")
        return `    FORMATS ${formats.join(" ")}\n`
    }
}()

export const productNameRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.product-name"
    readonly managedItemId = "project.name"

    protected override makeInner(state: ProjectState): string {
        return `    PRODUCT_NAME ${quote(state.project.project.name)}\n`
    }
}()

export const fetchContentCluster: TextCluster = new class extends TextCluster {
    readonly id = "cmake.fetch-content"
    readonly regions = [fetchContentRepositoryRegion, frameworkVersionRegion] as const

    protected override makeInner(state: ProjectState): string {
        return `include(FetchContent)
FetchContent_Declare(arrange
${fetchContentRepositoryRegion.make(state)}${frameworkVersionRegion.make(state)})
FetchContent_MakeAvailable(arrange)
`
    }
}()

export const jucePluginCluster: TextCluster = new class extends TextCluster {
    readonly id = "cmake.juce-plugin"
    readonly regions = [pluginVersionRegion, pluginIdentityRegion, pluginFormatsRegion, productNameRegion] as const

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
}()

export const cmakeListsFile: TextFile = new class extends TextFile {
    readonly id = "cmake-lists"
    readonly scope = "Native"
    readonly clusters = [fetchContentCluster, jucePluginCluster] as const

    override path(state: ProjectState): string {
        return resolve(state.rootDir, state.project.native.directory, "CMakeLists.txt")
    }

    override make(state: ProjectState): string {
        const name = state.project.project.name
        const fetchContent = fetchContentCluster.make(state)
        const plugin = jucePluginCluster.make(state)
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
}()
