import {fileURLToPath} from "node:url"
import vue from "@vitejs/plugin-vue"
import arrange from "@arrange/vite-plugin"

const packageRoot = fileURLToPath(new URL("../../packages", import.meta.url))

const vueAliases = [
    ["vue", `${packageRoot}/arrange-vue-runtime-core/src/index.ts`],
    ["@vue/shared", `${packageRoot}/arrange-vue-shared/src/index.ts`],
    ["@vue/reactivity", `${packageRoot}/arrange-vue-reactivity/src/index.ts`],
    ["@vue/runtime-core", `${packageRoot}/arrange-vue-runtime-core/src/index.ts`],
    ["@arrange/vue-shared", `${packageRoot}/arrange-vue-shared/src/index.ts`],
    ["@arrange/vue-reactivity", `${packageRoot}/arrange-vue-reactivity/src/index.ts`],
    ["@arrange/vue-runtime-core", `${packageRoot}/arrange-vue-runtime-core/src/index.ts`],
]

export default {
    resolve: {
        alias: Object.fromEntries(vueAliases),
    },
    plugins: [
        vue(),
        arrange(),
    ],
}
