import {cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync} from "node:fs"
import {basename, extname, join, relative, resolve} from "node:path"
import type {ArrangeConfig, Flavor, Product} from "./config.ts"
import {cmakeBuildDir} from "./project.ts"
import {platformArch} from "./process.ts"

export function packageArtifacts(config: ArrangeConfig, root: string, args: {flavor: Flavor; products: Product[]; clean?: boolean}): string[] {
    const written: string[] = []
    for (const product of args.products) {
        const destination = artifactProductDir(config, root, args.flavor, product)
        if (args.clean) rmSync(destination, {recursive: true, force: true})
        mkdirSync(destination, {recursive: true})
        const nativeArtifact = findNativeArtifact(config, root, args.flavor, product)
        if (!nativeArtifact) throw missingArtifactError(config, root, args.flavor, product)
        const nativeDestination = resolve(destination, basename(nativeArtifact))
        cpSync(nativeArtifact, nativeDestination, {recursive: true})
        written.push(relative(root, nativeDestination))

        const uiDist = resolve(root, config.ui.path, "dist")
        if (existsSync(uiDist)) {
            const uiDestination = productUiDestination(destination, product, nativeDestination)
            rmSync(uiDestination, {recursive: true, force: true})
            mkdirSync(uiDestination, {recursive: true})
            cpSync(uiDist, uiDestination, {recursive: true})
            written.push(relative(root, uiDestination))
        }
    }
    return written
}

function productUiDestination(productDestination: string, product: Product, nativeDestination: string): string {
    if (product === "vst3" || process.platform === "darwin" && nativeDestination.toLowerCase().endsWith(".app")) return resolve(nativeDestination, "Contents", "Resources", "ui")
    return resolve(productDestination, "ui")
}

function missingArtifactError(config: ArrangeConfig, root: string, flavor: Flavor, product: Product): Error {
    return new Error([
        `Native artifact not found.`,
        `  flavor: ${flavor}`,
        `  product: ${product}`,
        `Run: arrange build --native-only --flavor ${flavor} --product ${product}`,
        `Build directory: ${cmakeBuildDir(config, root, flavor)}`,
    ].join("\n"))
}

export function artifactProductDir(config: ArrangeConfig, root: string, flavor: Flavor, product: Product): string {
    return resolve(
        root,
        config.artifacts.path,
        flavor,
        ...(config.artifacts.includeVersionDir ? [config.project.version] : []),
        platformArch(),
        product,
    )
}

export function findNativeArtifact(config: ArrangeConfig, root: string, flavor: Flavor, product: Product): string | null {
    const buildDir = cmakeBuildDir(config, root, flavor)
    if (!existsSync(buildDir)) return null
    if (product === "standalone") {
        return findFirst(buildDir, (path) => {
            const name = basename(path).toLowerCase()
            if (process.platform === "darwin") return name === `${config.project.name.toLowerCase()}.app`
            if (process.platform === "win32") return name === `${config.project.name.toLowerCase()}.exe`
            return name === config.project.name.toLowerCase() || name === `${config.project.name.toLowerCase()}.appimage`
        })
    }
    return findFirst(buildDir, (path) => extname(path).toLowerCase() === ".vst3" || basename(path).toLowerCase() === `${config.project.name.toLowerCase()}.vst3`)
}

function findFirst(root: string, predicate: (path: string) => boolean): string | null {
    const stack = [root]
    while (stack.length) {
        const current = stack.pop()!
        for (const item of readdirSync(current)) {
            const path = join(current, item)
            const stat = statSync(path)
            if (predicate(path)) return path
            if (stat.isDirectory()) stack.push(path)
        }
    }
    return null
}
