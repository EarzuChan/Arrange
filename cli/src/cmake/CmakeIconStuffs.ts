import { nativeBundleIconName, nativeIconCmakeDefinitions, nativeWindowsIconOwnershipFile } from "../CliMetadata.ts"
import { TextRegion } from "../managed/TextRegion.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { quote } from "./CmakeText.ts"

export const productIconPreparationRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.product-icon-preparation"
    readonly managedItemId = "cmake.product-icon"

    protected override makeInner(state: ProjectState): string {
        if (state.project.project.icon === undefined) return ""
        const { ico, icns } = nativeIconCmakeDefinitions
        return `if(APPLE)
    if(NOT ${icns} OR NOT EXISTS "\${${icns}}")
        message(FATAL_ERROR "CLI 图标资源尚未准备，请运行 arrange sync --setup 或 arrange build")
    endif()
elseif(WIN32)
    if(NOT ${ico} OR NOT EXISTS "\${${ico}}")
        message(FATAL_ERROR "CLI 图标资源尚未准备，请运行 arrange sync --setup 或 arrange build")
    endif()
endif()
`
    }
}()

export const productIconPlistRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.product-icon-plist"
    readonly managedItemId = "cmake.product-icon"

    protected override makeInner(state: ProjectState): string {
        if (state.project.project.icon === undefined) return ""
        return `    PLIST_TO_MERGE ${quote(`<plist version="1.0"><dict><key>CFBundleIconFile</key><string>${nativeBundleIconName}</string></dict></plist>`)}\n`
    }
}()

export const productIconAssetsRegion: TextRegion = new class extends TextRegion {
    readonly id = "cmake.product-icon-assets"
    readonly managedItemId = "cmake.product-icon"

    protected override makeInner(state: ProjectState): string {
        const target = state.project.native.target
        const { ico, icns, presentation } = nativeIconCmakeDefinitions
        return `file(CONFIGURE OUTPUT "\${CMAKE_CURRENT_BINARY_DIR}/arrange-presentation.cpp" CONTENT "namespace { [[maybe_unused]] constexpr char arrangePresentation[] = \\\"\${${presentation}}\\\"; }\\n" @ONLY)
get_target_property(_arrange_icon_big ${target} JUCE_ICON_BIG)
get_target_property(_arrange_icon_small ${target} JUCE_ICON_SMALL)
if((${ico} OR ${icns}) AND (_arrange_icon_big OR _arrange_icon_small))
    message(FATAL_ERROR "CLI 图标与 JUCE ICON_BIG/ICON_SMALL 冲突，请移除 project.icon 并自行维护图标接入，或移除手工 ICON_BIG/ICON_SMALL")
endif()
set(_arrange_keep_manual_icon FALSE)
if(_arrange_icon_big OR _arrange_icon_small)
    set(_arrange_keep_manual_icon TRUE)
endif()
foreach(_arrange_product IN ITEMS ${target}_Standalone ${target}_VST3)
    if(NOT TARGET \${_arrange_product})
        continue()
    endif()
    get_target_property(_arrange_product_source \${_arrange_product} SOURCE_DIR)
    if(NOT _arrange_product_source STREQUAL CMAKE_CURRENT_SOURCE_DIR)
        message(FATAL_ERROR "CLI 托管产品图标资源段必须与 juce_add_plugin 位于同一 CMake 目录（目标：\${_arrange_product}）；请将资源段移到目标定义目录，或取消 cmake.product-icon 托管并自行维护图标接入")
    endif()
    target_sources(\${_arrange_product} PRIVATE "\${CMAKE_CURRENT_BINARY_DIR}/arrange-presentation.cpp")
    if(APPLE)
        if(${icns})
            configure_file("\${${icns}}" "\${CMAKE_CURRENT_BINARY_DIR}/${nativeBundleIconName}" COPYONLY)
            target_sources(\${_arrange_product} PRIVATE "\${CMAKE_CURRENT_BINARY_DIR}/${nativeBundleIconName}")
            set_source_files_properties("\${CMAKE_CURRENT_BINARY_DIR}/${nativeBundleIconName}" PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
        else()
            add_custom_command(TARGET \${_arrange_product} POST_BUILD
                COMMAND "\${CMAKE_COMMAND}" -E rm -f "$<TARGET_BUNDLE_CONTENT_DIR:\${_arrange_product}>/Resources/${nativeBundleIconName}"
                VERBATIM)
        endif()
    elseif(WIN32)
        if(_arrange_product STREQUAL "${target}_Standalone")
            if(${ico})
                file(WRITE "\${CMAKE_CURRENT_BINARY_DIR}/arrange-icon.rc" "#pragma code_page(65001)\\n101 ICON \\\"\${${ico}}\\\"\\n")
                target_sources(\${_arrange_product} PRIVATE "\${CMAKE_CURRENT_BINARY_DIR}/arrange-icon.rc")
            endif()
        elseif(${ico})
            file(WRITE "\${CMAKE_CURRENT_BINARY_DIR}/arrange-desktop.ini" "[.ShellClassInfo]\\r\\nIconResource=Plugin.ico,0\\r\\nIconFile=Plugin.ico\\r\\nIconIndex=0\\r\\n")
            add_custom_command(TARGET \${_arrange_product} POST_BUILD
                COMMAND "\${CMAKE_COMMAND}" -E copy_if_different "\${${ico}}" "$<TARGET_FILE_DIR:\${_arrange_product}>/../../Plugin.ico"
                COMMAND "\${CMAKE_COMMAND}" -E copy_if_different "\${CMAKE_CURRENT_BINARY_DIR}/arrange-desktop.ini" "$<TARGET_FILE_DIR:\${_arrange_product}>/../../desktop.ini"
                COMMAND "\${CMAKE_COMMAND}" -E touch "$<TARGET_FILE_DIR:\${_arrange_product}>/../../${nativeWindowsIconOwnershipFile}"
                COMMAND attrib +s +h "$<TARGET_FILE_DIR:\${_arrange_product}>/../../desktop.ini"
                COMMAND attrib +s "$<TARGET_FILE_DIR:\${_arrange_product}>/../.."
                VERBATIM)
        else()
            file(WRITE "\${CMAKE_CURRENT_BINARY_DIR}/arrange-clear-icon.cmake" [=[
if(EXISTS "\${BUNDLE_DIRECTORY}/${nativeWindowsIconOwnershipFile}")
    if(NOT KEEP_MANUAL_ICON)
        if(EXISTS "\${BUNDLE_DIRECTORY}/desktop.ini")
            execute_process(COMMAND attrib -s -h "\${BUNDLE_DIRECTORY}/desktop.ini" COMMAND_ERROR_IS_FATAL ANY)
        endif()
        execute_process(COMMAND attrib -s "\${BUNDLE_DIRECTORY}" COMMAND_ERROR_IS_FATAL ANY)
        file(REMOVE "\${BUNDLE_DIRECTORY}/Plugin.ico" "\${BUNDLE_DIRECTORY}/desktop.ini")
    endif()
    file(REMOVE "\${BUNDLE_DIRECTORY}/${nativeWindowsIconOwnershipFile}")
endif()
]=])
            add_custom_command(TARGET \${_arrange_product} POST_BUILD
                COMMAND "\${CMAKE_COMMAND}" "-DBUNDLE_DIRECTORY=$<TARGET_FILE_DIR:\${_arrange_product}>/../.." "-DKEEP_MANUAL_ICON=\${_arrange_keep_manual_icon}" -P "\${CMAKE_CURRENT_BINARY_DIR}/arrange-clear-icon.cmake"
                VERBATIM)
        endif()
    endif()
endforeach()
`
    }
}()
