import assert from "node:assert/strict"
import {test} from "node:test"
import {createServer} from "node:http"
import {once} from "node:events"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
import {readFile, readdir, rm} from "node:fs/promises"
import {fixture, write} from "./fixture.ts"
import {ProjectStateStore} from "../src/project/ProjectStateStore.ts"
import {managedFiles} from "../src/managed/ManagedDefinitions.ts"
import {cmakeListsFile} from "../src/cmake/CmakeTextStuffs.ts"
import {cliCompatibility} from "../src/CliMetadata.ts"

const exec = promisify(execFile)
const sourceEntry = fileURLToPath(new URL("../src/Entry.ts", import.meta.url))

async function cli(root: string, args: string[]) {
    try {
        const result = await exec(process.execPath, ["--experimental-transform-types", sourceEntry, ...args], {cwd: root, env: {...process.env, NODE_NO_WARNINGS: "1"}, timeout: 15000})
        return {...result, code: 0}
    } catch (error) {
        const failure = error as Error & {code: number, stdout: string, stderr: string}
        return {stdout: failure.stdout, stderr: failure.stderr, code: failure.code}
    }
}

test("真实 CLI：只读扫描、Apply、Fatal 退出码与参数互斥", async t => {
    const state = await fixture(t, false)
    const requests: string[] = []
    const server = createServer((request, response) => {
        requests.push(request.url ?? "")
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({version: state.project.framework.version, arrange: {cliCompatibility}}))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    state.project.framework.nodeRegistryUrl = `http://127.0.0.1:${address.port}`
    const store = new ProjectStateStore()
    await store.save(state)
    for (const file of managedFiles) await write(file.path(state), file.make(state))

    state.project.project.version = "2.0.0"
    await store.save(state)
    const before = await readFile(cmakeListsFile.path(state), "utf8")
    const scan = await cli(state.rootDir, ["sync", "--config", "--scan"])
    assert.equal(scan.code, 0, scan.stderr)
    assert.match(scan.stdout, /Applicable .*cmake.plugin-version/)
    assert.equal(await readFile(cmakeListsFile.path(state), "utf8"), before)
    await assert.rejects(readdir(join(state.rootDir, ".arrange")), {code: "ENOENT"})

    const applied = await cli(state.rootDir, ["sync", "--config"])
    assert.equal(applied.code, 0, applied.stderr + applied.stdout)
    assert.match(await readFile(cmakeListsFile.path(state), "utf8"), /VERSION "2.0.0"/)
    const idle = await cli(state.rootDir, ["sync", "--config", "--scan"])
    assert.equal(idle.code, 0)
    assert.match(idle.stdout, /Applicable 0/)
    assert.ok(requests.every(path => path === `/@arrange%2fframework/${state.project.framework.version}`))

    for (const args of [["--config", "--setup"], ["--ui", "--native"], ["--config-only"]]) {
        const invalid = await cli(state.rootDir, ["sync", ...args])
        assert.notEqual(invalid.code, 0)
    }
    const setup = await cli(state.rootDir, ["sync", "--setup"])
    assert.notEqual(setup.code, 0)
    assert.match(setup.stdout, /SETUP 尚未实现/)

    await rm(cmakeListsFile.path(state))
    const missing = await cli(state.rootDir, ["sync", "--config", "--scan", "--native"])
    assert.equal(missing.code, 1)
    assert.match(missing.stdout, /Resolvable .*CMakeLists.txt/)
    const nonInteractive = await cli(state.rootDir, ["sync", "--config", "--native"])
    assert.equal(nonInteractive.code, 1)
    assert.match(nonInteractive.stderr, /需要交互/)

    await write(join(state.rootDir, "arrange.project.yaml"), "[")
    const fatal = await cli(state.rootDir, ["sync", "--config", "--scan"])
    assert.equal(fatal.code, 1)
    assert.match(fatal.stdout, /Fatal .*arrange.project.yaml/)
})
