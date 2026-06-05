import {relative, resolve} from "node:path"
import type {ProjectState} from "../project/ProjectState.ts"
import {writeTextFile} from "../utils/utils.ts"

export class NodeProjectGenerator {
    async generate(rootDir: string, state: ProjectState): Promise<string[]> {
        const uiDir = resolve(rootDir, state.project.ui.directory)
        const srcDir = resolve(uiDir, "src")
        const packageJsonPath = resolve(uiDir, "package.json")
        const npmrcPath = resolve(uiDir, ".npmrc")
        const mainPath = resolve(srcDir, "main.ts")
        const appPath = resolve(srcDir, "App.vue")

        const files = [
            {path: packageJsonPath, content: createPackageJson(state)},
            ...(state.project.framework.nodeRegistryUrl ? [{path: npmrcPath, content: createNpmrc(state.project.framework.nodeRegistryUrl)}] : []),
            {path: mainPath, content: createMainTs()},
            {path: appPath, content: createAppVue(state)},
        ]

        const written: string[] = []
        for (const file of files) {
            await writeTextFile(file.path, file.content)
            written.push(relative(rootDir, file.path))
        }
        return written
    }
}

function createPackageJson(state: ProjectState): string {
    return `${JSON.stringify({
        name: packageName(state.project.name),
        private: true,
        type: "module",
        dependencies: {"@arrange/framework": state.project.framework.version}
    }, null, 2)}\n`
}

function createNpmrc(registryUrl: string): string {
    return `@arrange:registry=${registryUrl.replace(/\/+$/, "")}\n`
}

function createMainTs(): string {
    return [
        `import { createApp } from "@arrange/framework"`,
        `import App from "./App.vue"`,
        "",
        "createApp(App).mount()",
        "",
    ].join("\n")
}

function createAppVue(state: ProjectState): string {
    return [
        "<template>",
        "  <Column>",
        `    <Text text="${escapeVueAttribute(state.project.name)}" />`,
        "  </Column>",
        "</template>",
        "",
    ].join("\n")
}

// CHECK：嗯🤔...
function packageName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "arrange-app"
}

function escapeVueAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
