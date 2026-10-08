import { confirm, isCancel, log, select, spinner } from "@clack/prompts"
import { cliCompatibility, frameworkPackageName } from "../CliMetadata.ts"
import { type FrameworkRegistryClient, normalizeRegistryUrl } from "../framework/FrameworkRegistryClient.ts"
import { assertFrameworkCompatible, addIncompatibilityIfPresenceFor, type FrameworkVersionSelectionCandidate, type FrameworkVersionCandidate } from "../framework/FrameworkMamba.ts"
import { PromptCancelled, requiredText, validateSemver } from "../util/PromptUtils.ts"
import { formatTimestampToDate } from "../util/Utils.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"

export interface FrameworkVersionWizardInput {
    readonly registryUrl?: string
}

const customVersionValue = "custom"
const retryValue = "retry"
const enterAnotherVersionValue = "enter-another-version"
const skipVerificationValue = "skip-verification"
const cancelValue = "cancel"

// 本方法执行版本选择
export async function selectFrameworkVersion(registryClient: FrameworkRegistryClient, input: FrameworkVersionWizardInput = {}): Promise<string> {
    const registryUrl = normalizeRegistryUrl(input.registryUrl)

    const tryLoadCandidatesResult = await tryLoadRegistryCandidates(registryClient, registryUrl)

    if (tryLoadCandidatesResult === false) while (true) {
        const customCandidate = await promptCustomFrameworkVersion(registryClient, registryUrl)
        if (customCandidate === false) throw new PromptCancelled()

        const useCustomVersion = await confirm({
            message: `使用 ${frameworkPackageName}@${customCandidate.version}？选择“否”可以重新输入版本`,
            initialValue: true,
            active: "是",
            inactive: "否",
        })
        if (isCancel(useCustomVersion)) throw new PromptCancelled()

        if (useCustomVersion) return customCandidate.version
    }

    const customCandidates: FrameworkVersionSelectionCandidate[] = []

    while (true) {
        const selected = await select({
            message: `选择 Arrange Framework 版本（CLI 兼容契约 ${cliCompatibility}）`,
            options: [
                ...toCandidateOptions([...tryLoadCandidatesResult, ...customCandidates]),
                { label: "自定义版本", value: customVersionValue },
            ],
            maxItems: 8, // TIPS：多了会有得滚动
        })
        if (isCancel(selected)) throw new PromptCancelled()
        if (selected !== customVersionValue) return selected

        const customCandidate = await promptCustomFrameworkVersion(registryClient, registryUrl)
        if (customCandidate === false) continue

        if (hasCandidateVersion(tryLoadCandidatesResult, customCandidate.version) || hasCandidateVersion(customCandidates, customCandidate.version)) log.info(`${customCandidate.version} 已在版本列表中`)
        else {
            customCandidates.push(customCandidate)
            log.success(`${customCandidate.version} 已加入版本列表`)
        }
    }
}

async function tryLoadRegistryCandidates(registryClient: FrameworkRegistryClient, registryUrl: string): Promise<FrameworkVersionSelectionCandidate[] | false> {
    while (true) {
        const loading = spinner()
        loading.start("正在读取 Arrange Framework 版本……")
        try {
            const candidates = await registryClient.fetchCandidates(5, registryUrl)
            loading.stop("已读取 Arrange Framework 版本")
            return addIncompatibilityIfPresenceFor(candidates)
        } catch (error) {
            if (isAbortError(error)) {
                loading.stop("已取消读取 Framework 版本")
                throw error
            }
            loading.error("读取 Arrange Framework 版本失败")
            log.error(formatError(error))

            const action = await select({
                message: "无法读取 Framework 版本列表",
                options: [
                    { label: "重试", value: retryValue },
                    { label: "输入自定义版本", value: customVersionValue },
                    { label: "取消版本选择", value: cancelValue },
                ],
            })

            if (isCancel(action) || action === cancelValue) throw new PromptCancelled()
            if (action === customVersionValue) return false
        }
    }
}

async function promptCustomFrameworkVersion(registryClient: FrameworkRegistryClient, registryUrl: string): Promise<FrameworkVersionSelectionCandidate | false> {
    while (true) {
        let version
        try {
            version = await requiredText("自定义 Arrange Framework 版本", {
                placeholder: "例如 1.0.0",
                validate: validateSemver,
            })
        } catch (error) {
            if (error instanceof PromptCancelled) {
                log.info("已取消自定义版本输入")
                return false
            }

            throw error
        }

        while (true) {
            const checking = spinner()
            checking.start(`正在验证 ${version}……`)

            try {
                const candidate = await registryClient.fetchCandidateByVersion(version, registryUrl)
                assertFrameworkCompatible(candidate)

                checking.stop(`${candidate.version} 与当前 CLI 兼容`)
                return { ...candidate, incompatibility: null }
            } catch (error) {
                if (isAbortError(error)) {
                    checking.stop("已取消验证 Framework 版本")
                    throw error
                }
                checking.error(`无法验证 ${version}`)
                log.error(formatError(error))

                const action = await select({
                    message: "如何处理这个自定义版本？",
                    options: [
                        { label: "重新验证此版本", value: retryValue },
                        { label: "输入其他版本", value: enterAnotherVersionValue },
                        { label: "跳过验证并使用此版本", value: skipVerificationValue },
                        { label: "取消自定义版本", value: cancelValue },
                    ],
                })

                if (isCancel(action) || action === cancelValue) return false
                else if (action === retryValue) continue
                else if (action === enterAnotherVersionValue) break

                log.warn(`将使用未经验证的 ${frameworkPackageName}@${version}；版本不存在或不兼容时，后续同步或安装可能失败`)
                return {
                    version,
                    cliCompatibility: cliCompatibility, // 强行认为它以兼容
                    markedLatest: false,
                    publishedAt: null,
                    incompatibility: null,
                }
            }
        }
    }
}

function toCandidateOptions(candidates: readonly FrameworkVersionSelectionCandidate[]) {
    return candidates.map((candidate, index) => {
        const label = `${candidate.markedLatest ? "LATEST " : ""}${candidate.version}`

        let hint: string | undefined = undefined // 不兼容告示 or 时间
        if (candidate.incompatibility !== null) hint = candidate.incompatibility
        else if (candidate.publishedAt) hint = formatTimestampToDate(candidate.publishedAt)

        return { label, value: candidate.incompatibility === null ? candidate.version : `disabled:${index}`, hint, disabled: candidate.incompatibility !== null, }
    })
}

function hasCandidateVersion(candidates: readonly FrameworkVersionCandidate[], version: string): boolean {
    return candidates.some((candidate) => candidate.version === version)
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
