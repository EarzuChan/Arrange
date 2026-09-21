import { defineConfig } from "vite"
import arrange from "@arrange/framework/vite"

export default defineConfig({
    plugins: [arrange()],
})