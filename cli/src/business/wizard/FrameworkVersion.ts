import { confirm, isCancel, select } from "../../terminal/Prompts.ts"
import { cliCompatibility, frameworkPackageName } from "../../CliMetadata.ts"
import { type FrameworkRegistryClient, normalizeRegistryUrl } from "../../feature/framework/FrameworkRegistryClient.ts"
import { assertFrameworkCompatible, addIncompatibilityIfPresenceFor, type FrameworkVersionSelectionCandidate, type FrameworkVersionCandidate } from "../../feature/framework/FrameworkMamba.ts"
import { PromptCancelled, requiredText, validateSemver } from "../PromptUtils.ts"
import { formatTimestampToDate } from "../../util/Utils.ts"
import { isAbortError } from "../../feature/platform/ProcessSpec.ts"
import type { CommandInterface } from "../CommandInterface.ts"

export interface FrameworkVersionWizardInput {
    readonly registryUrl?: string
}

const customVersionValue = "custom"
const retryValue = "retry"
const enterAnotherVersionValue = "enter-another-version"
const skipVerificationValue = "skip-verification"
const cancelValue = "cancel"

// 本方法执行版本选择
export async function selectFrameworkVersion(terminal: CommandInterface, registryClient: FrameworkRegistryClient, input: FrameworkVersionWizardInput = {}): Promise<string> {
    const registryUrl = normalizeRegistryUrl(input.registryUrl)

    const tryLoadCandidatesResult = await tryLoadRegistryCandidates(terminal, registryClient, registryUrl)

    if (tryLoadCandidatesResult === false) while (true) {
        const customCandidate = await promptCustomFrameworkVersion(terminal, registryClient, registryUrl)
        if (customCandidate === false) throw new PromptCancelled()

        const useCustomVersion = await confirm({
            ...terminal.prompt,
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
            ...terminal.prompt,
            message: `选择 Arrange Framework 版本（CLI 兼容契约 ${cliCompatibility}）`,
            options: [
                ...toCandidateOptions([...tryLoadCandidatesResult, ...customCandidates]),
                { label: "自定义版本", value: customVersionValue },
            ],
        })
        if (isCancel(selected)) throw new PromptCancelled()
        if (selected !== customVersionValue) return selected

        const customCandidate = await promptCustomFrameworkVersion(terminal, registryClient, registryUrl)
        if (customCandidate === false) continue

        if (hasCandidateVersion(tryLoadCandidatesResult, customCandidate.version) || hasCandidateVersion(customCandidates, customCandidate.version)) terminal.reporter.info(`${customCandidate.version} 已在版本列表中`)
        else {
            customCandidates.push(customCandidate)
            terminal.reporter.success(`${customCandidate.version} 已加入版本列表`)
        }
    }
}

async function tryLoadRegistryCandidates(terminal: CommandInterface, registryClient: FrameworkRegistryClient, registryUrl: string): Promise<FrameworkVersionSelectionCandidate[] | false> {
    while (true) {
        try {
            const candidates = await terminal.tasks.status("正在读取 Arrange Framework 版本", () => registryClient.fetchCandidates(5, registryUrl))
            terminal.reporter.step("已读取 Arrange Framework 版本")
            return addIncompatibilityIfPresenceFor(candidates)
        } catch (error) {
            if (isAbortError(error)) throw error
            terminal.reporter.error(["读取 Arrange Framework 版本失败", formatError(error)])

            const action = await select({
                ...terminal.prompt,
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

async function promptCustomFrameworkVersion(terminal: CommandInterface, registryClient: FrameworkRegistryClient, registryUrl: string): Promise<FrameworkVersionSelectionCandidate | false> {
    while (true) {
        let version
        try {
            version = await requiredText(terminal.prompt, "自定义 Arrange Framework 版本", {
                placeholder: "例如 1.0.0",
                validate: validateSemver,
            })
        } catch (error) {
            if (error instanceof PromptCancelled) {
                terminal.reporter.info("已取消自定义版本输入")
                return false
            }

            throw error
        }

        while (true) {
            try {
                const candidate = await terminal.tasks.status(`正在验证 ${version}`, () => registryClient.fetchCandidateByVersion(version, registryUrl))
                assertFrameworkCompatible(candidate)

                terminal.reporter.step(`${candidate.version} 与当前 CLI 兼容`)
                return { ...candidate, incompatibility: null }
            } catch (error) {
                if (isAbortError(error)) throw error
                terminal.reporter.error([`无法验证 ${version}`, formatError(error)])

                const action = await select({
                    ...terminal.prompt,
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

                terminal.reporter.warn(`将使用未经验证的 ${frameworkPackageName}@${version}；版本不存在或不兼容时，后续同步或安装可能失败`)
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
