import {resolve} from "node:path"
import {TextFile} from "../managed/ManagedFile.ts"
import {TextCluster} from "../managed/TextCluster.ts"
import {TextRegion} from "../managed/TextRegion.ts"
import {managedItemIds} from "../managed/ManagedItem.ts"

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/;/g, "\\;")}"`
const defaultFetchUrl = "https://github.com/EarzuChan/Arrange.git"

export const fetchContentRepositoryRegion = new TextRegion("cmake.fetch-content-repository", managedItemIds.fetchContentRepository, state => `    GIT_REPOSITORY ${quote(state.project.framework.cmakeFetchContentUrl ?? defaultFetchUrl)}\n`)
export const frameworkVersionRegion = new TextRegion("cmake.framework-version", managedItemIds.frameworkVersion, state => `    GIT_TAG ${quote(`v${state.project.framework.version}`)}\n`)
export const pluginVersionRegion = new TextRegion("cmake.plugin-version", managedItemIds.pluginVersion, state => `    VERSION ${quote(state.project.project.version)}\n`)
export const pluginIdentityRegion = new TextRegion("cmake.plugin-identity", managedItemIds.pluginIdentity, state => `    COMPANY_NAME ${quote(state.project.project.vendorName)}\n    PLUGIN_MANUFACTURER_CODE ${state.project.project.vendorCode}\n    PLUGIN_CODE ${state.project.project.pluginCode}\n`)
export const pluginFormatsRegion = new TextRegion("cmake.plugin-formats", managedItemIds.pluginFormats, state => `    FORMATS ${state.project.project.products.map(product => product === "standalone" ? "Standalone" : "VST3").join(" ")}\n`)
export const productNameRegion = new TextRegion("cmake.product-name", managedItemIds.projectName, state => `    PRODUCT_NAME ${quote(state.project.project.name)}\n`)

export const fetchContentCluster = new TextCluster("cmake.fetch-content", [fetchContentRepositoryRegion, frameworkVersionRegion], state => `include(FetchContent)\nFetchContent_Declare(arrange\n${fetchContentRepositoryRegion.make(state)}${frameworkVersionRegion.make(state)})\nFetchContent_MakeAvailable(arrange)\n`)
export const jucePluginCluster = new TextCluster("cmake.juce-plugin", [pluginVersionRegion, pluginIdentityRegion, pluginFormatsRegion, productNameRegion], state => `juce_add_plugin(${state.project.project.name}\n${pluginVersionRegion.make(state)}${pluginIdentityRegion.make(state)}${pluginFormatsRegion.make(state)}${productNameRegion.make(state)}    IS_SYNTH ${state.project.native.pluginType === "instrument" ? "TRUE" : "FALSE"}\n    NEEDS_MIDI_INPUT ${state.project.native.pluginType === "instrument" ? "TRUE" : "FALSE"}\n    NEEDS_MIDI_OUTPUT FALSE\n    IS_MIDI_EFFECT FALSE\n    EDITOR_WANTS_KEYBOARD_FOCUS TRUE\n    COPY_PLUGIN_AFTER_BUILD FALSE\n)\n`)

export const cmakeListsFile = new TextFile("cmake-lists", "Native", state => resolve(state.rootDir, state.project.native.directory, "CMakeLists.txt"), [fetchContentCluster, jucePluginCluster], state => `cmake_minimum_required(VERSION 3.24)\nproject(${state.project.project.name} LANGUAGES C CXX)\n\nset(CMAKE_CXX_STANDARD 20)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\n\n${fetchContentCluster.make(state)}\n${jucePluginCluster.make(state)}\njuce_generate_juce_header(${state.project.project.name})\ntarget_sources(${state.project.project.name} PRIVATE Source/${state.project.project.name}Processor.cpp)\ntarget_compile_definitions(${state.project.project.name} PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)\ntarget_compile_definitions(${state.project.project.name} PUBLIC JUCE_VST3_CAN_REPLACE_VST2=0)\ntarget_link_libraries(${state.project.project.name} PRIVATE\n    Arrange::framework\n    juce::juce_audio_utils\n    juce::juce_dsp\n    juce::juce_recommended_config_flags\n    juce::juce_recommended_lto_flags\n    juce::juce_recommended_warning_flags\n)\n`)
