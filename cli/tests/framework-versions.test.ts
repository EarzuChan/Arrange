import assert from "node:assert/strict"
import { createServer, type IncomingMessage } from "node:http"
import { once } from "node:events"
import { test, type TestContext } from "node:test"
import { cliCompatibility } from "../src/CliMetadata.ts"
import { FrameworkRegistryClient } from "../src/feature/framework/FrameworkRegistryClient.ts"
import { addIncompatibilityIfPresenceFor, assertFrameworkCompatible } from "../src/feature/framework/FrameworkMamba.ts"
import { validateSemver } from "../src/business/PromptUtils.ts"

async function registry(t: TestContext, handler: (request: IncomingMessage) => { status?: number, body: unknown }) {
    const requests: string[] = []
    const server = createServer((request, response) => {
        requests.push(request.url!)
        const result = handler(request)
        response.writeHead(result.status ?? 200, { "Content-Type": "application/json" })
        response.end(JSON.stringify(result.body))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
    }))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    return { client: new FrameworkRegistryClient(), url: `http://127.0.0.1:${address.port}`, requests }
}

function packument(latest: string) {
    const versions = Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
        const version = `1.0.${index + 1}`
        return [version, { version, arrange: { cliCompatibility } }]
    }))
    const time = Object.fromEntries(Object.keys(versions).map((version, index) => [version, `2026-10-0${index + 1}T12:00:00.000Z`]))
    return { "dist-tags": { latest }, versions, time }
}

test("latest 与最近五个版本重叠时只出现一次，保留 latest 标记和日期", async t => {
    const input = await registry(t, () => ({ body: packument("1.0.6") }))
    const candidates = await input.client.fetchCandidates(5, `${input.url}///`)
    assert.deepEqual(candidates.map(candidate => candidate.version), ["1.0.6", "1.0.5", "1.0.4", "1.0.3", "1.0.2"])
    assert.equal(new Set(candidates.map(candidate => candidate.version)).size, candidates.length)
    assert.equal(candidates[0].markedLatest, true)
    assert.equal(candidates.filter(candidate => candidate.markedLatest).length, 1)
    assert.equal(candidates[0].publishedAt, "2026-10-06T12:00:00.000Z")
    assert.equal(candidates[0].cliCompatibility, cliCompatibility)
    assert.deepEqual(input.requests, ["/@arrange%2fframework"])
})

test("较旧的 latest 仍置顶，recent 以发布时间排序且遵守数量限制", async t => {
    const input = await registry(t, () => ({ body: packument("1.0.1") }))
    const candidates = await input.client.fetchCandidates(3, input.url)
    assert.deepEqual(candidates.map(candidate => candidate.version), ["1.0.1", "1.0.6", "1.0.5", "1.0.4"])
    assert.equal(candidates[0].markedLatest, true)
    assert.ok(candidates.slice(1).every(candidate => !candidate.markedLatest))
})

test("无 latest 或发布时间时版本仍可选；缺契约和不兼容候选保留中文原因", async t => {
    const input = await registry(t, () => ({
        body: {
            versions: {
                "1.0.2": { version: "1.0.2", arrange: { cliCompatibility } },
                "1.0.10": { version: "1.0.10", arrange: { cliCompatibility: cliCompatibility + 1 } },
                "1.0.3": { version: "1.0.3" },
            }
        }
    }))
    const choices = addIncompatibilityIfPresenceFor(await input.client.fetchCandidates(5, input.url))
    assert.deepEqual(choices.map(candidate => candidate.version), ["1.0.10", "1.0.3", "1.0.2"])
    assert.ok(choices.every(candidate => !candidate.markedLatest && candidate.publishedAt === null))
    assert.match(choices[0].incompatibility!, /不兼容.*cliCompatibility/)
    assert.match(choices[1].incompatibility!, /未声明有效的 arrange\.cliCompatibility/)
    assert.equal(choices[2].incompatibility, null)
    assert.throws(() => assertFrameworkCompatible(choices[0]), /CLI 兼容契约不一致/)
    assert.doesNotThrow(() => assertFrameworkCompatible(choices[2]))
})

test("自定义版本接受具体 SemVer 并读取真实契约；HTTP 和缺契约错误使用中文", async t => {
    const version = "1.2.3-preview.1+build.7"
    const input = await registry(t, request => {
        const selected = decodeURIComponent(request.url!.slice(request.url!.lastIndexOf("/") + 1))
        if (selected === version) return { body: { version, arrange: { cliCompatibility } } }
        if (selected === "1.0.0") return { body: { version: selected } }
        return { status: 404, body: { error: "not found" } }
    })
    assert.equal(validateSemver(version), undefined)
    assert.match(validateSemver("latest")!, /请输入有效的 SemVer/)
    assert.match(validateSemver("^1.2.3")!, /请输入有效的 SemVer/)
    const candidate = await input.client.fetchCandidateByVersion(version, input.url)
    assert.equal(candidate.version, version)
    assert.equal(candidate.cliCompatibility, cliCompatibility)
    assert.doesNotThrow(() => assertFrameworkCompatible(candidate))
    assert.ok(input.requests[0].endsWith("1.2.3-preview.1%2Bbuild.7"))
    await assert.rejects(input.client.fetchCandidateByVersion("1.0.0", input.url), /未声明有效的 arrange\.cliCompatibility/)
    await assert.rejects(input.client.fetchCandidateByVersion("9.9.9", input.url), /无法从.*HTTP 404/)
})

test('单版本响应必须包含请求的确切版本及有效正整数契约', async t => {
    const inputs: unknown[] = [null, [], {}, { arrange: { cliCompatibility } }, { version: '1.0.1', arrange: { cliCompatibility } }, ...[null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ version: '1.0.0', arrange: { cliCompatibility: value } }))]
    for (const body of inputs) {
        const input = await registry(t, () => ({ body }))
        await assert.rejects(input.client.fetchCandidateByVersion('1.0.0', input.url), /version|版本与请求不符|cliCompatibility/)
    }
    for (const version of ['latest', '^1.0.0', '1.0.0-01', '1.0.0-a..b', '1.0.0+']) {
        assert.ok(validateSemver(version), version)
        await assert.rejects(new FrameworkRegistryClient().fetchCandidateByVersion(version), /具体的 SemVer/)
    }
})

test('版本目录忽略键值不一致和非具体版本，不把损坏 metadata 作为候选', async t => {
    const input = await registry(t, () => ({ body: { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { version: '9.9.9', arrange: { cliCompatibility } }, '1.0.1': null, latest: { version: 'latest' }, '1.0.2': { version: '1.0.2', arrange: { cliCompatibility: 0 } }, '1.0.3': { version: '1.0.3', arrange: { cliCompatibility } } } } }))
    const candidates = addIncompatibilityIfPresenceFor(await input.client.fetchCandidates(5, input.url))
    assert.deepEqual(candidates.map(candidate => candidate.version), ['1.0.3', '1.0.2'])
    assert.equal(candidates[1].cliCompatibility, null)
    assert.ok(candidates[1].incompatibility)
})

test('registry 限流和服务暂不可用归为可重试错误，404 仍是确定否定', async t => {
    let status = 503
    const input = await registry(t, () => ({ status, body: {} }))
    const { RegistryUnreachableError } = await import('../src/feature/framework/FrameworkErrors.ts')
    for (status of [408, 425, 429, 500, 503]) {
        await assert.rejects(input.client.fetchCandidates(5, input.url), RegistryUnreachableError)
        await assert.rejects(input.client.fetchCandidateByVersion('1.0.0', input.url), RegistryUnreachableError)
    }
    status = 404
    await assert.rejects(input.client.fetchCandidateByVersion('1.0.0', input.url), error => {
        assert.ok(!(error instanceof RegistryUnreachableError))
        assert.match((error as Error).message, /HTTP 404/)
        return true
    })
})
