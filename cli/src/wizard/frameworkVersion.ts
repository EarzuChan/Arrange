import {confirm, isCancel, log, select, spinner} from "@clack/prompts"
import {cliCompatibility} from "../CliMetadata.ts"
import {FrameworkRegistryClient, normalizeRegistryUrl} from "../framework/FrameworkRegistryClient.ts"
import {assertFrameworkCompatible, addIncompatibilityIfPresenceFor, FrameworkVersionSelectionCandidate, FrameworkVersionCandidate} from "../framework/FrameworkMamba.ts"
import {PromptCancelled, requiredText, validateSemver} from "../utils/PromptUtils.ts"
import {formatTimestampToDate} from "../utils/Utils.ts";

export interface FrameworkVersionWizardInput {
    readonly registryUrl?: string
    readonly registryClient?: FrameworkRegistryClient
}

const customVersionValue = "custom"
const retryValue = "retry"
const enterAnotherVersionValue = "enter-another-version"
const skipVerificationValue = "skip-verification"
const cancelValue = "cancel"

// TIPS：本方法执行版本选择
export async function selectFrameworkVersion(input: FrameworkVersionWizardInput = {}): Promise<string> {
    const registryClient = input.registryClient ?? new FrameworkRegistryClient()
    const registryUrl = normalizeRegistryUrl(input.registryUrl)

    const tryLoadCandidatesResult = await tryLoadRegistryCandidates(registryClient, registryUrl)

    if (tryLoadCandidatesResult === false) while (true) {
        const customCandidate = await promptCustomFrameworkVersion(registryClient, registryUrl)
        if (customCandidate === false) throw new PromptCancelled()

        const useCustomVersion = await confirm({
            message: `Use @arrange/framework@${customCandidate.version}? Select no to type your version once again.`,
            initialValue: true,
        })
        if (isCancel(useCustomVersion)) throw new PromptCancelled()

        if (useCustomVersion) return customCandidate.version
    }

    const customCandidates: FrameworkVersionSelectionCandidate[] = []

    while (true) {
        const selected = await select({
            message: `Arrange framework version (CLI compatibility ${cliCompatibility})`,
            options: [
                ...toCandidateOptions([...tryLoadCandidatesResult, ...customCandidates]),
                {label: "Custom version", value: customVersionValue},
            ],
            maxItems: 8, // TIPS：多了会有得滚动
        })
        if (isCancel(selected)) throw new PromptCancelled()
        if (selected !== customVersionValue) return selected

        const customCandidate = await promptCustomFrameworkVersion(registryClient, registryUrl)
        if (customCandidate === false) continue

        if (hasCandidateVersion(tryLoadCandidatesResult, customCandidate.version) || hasCandidateVersion(customCandidates, customCandidate.version)) log.info(`${customCandidate.version} is already in the list.`)
        else {
            customCandidates.push(customCandidate)
            log.success(`${customCandidate.version} has been added to the version list.`)
        }
    }
}

async function tryLoadRegistryCandidates(registryClient: FrameworkRegistryClient, registryUrl: string,): Promise<FrameworkVersionSelectionCandidate[] | false> {
    while (true) {
        const loading = spinner()
        loading.start("Reading Arrange framework versions...")
        try {
            const candidates = await registryClient.fetchCandidates(5, registryUrl)
            loading.stop("Arrange framework versions loaded.")
            return addIncompatibilityIfPresenceFor(candidates)
        } catch (error) {
            loading.error("Failed to read Arrange framework versions.")
            log.error(formatError(error))

            const action = await select({
                message: "Cannot read the framework version list.",
                options: [
                    {label: "Retry", value: retryValue},
                    {label: "Enter custom version", value: customVersionValue},
                    {label: "Cancel create", value: cancelValue},
                ],
            })

            if (isCancel(action) || action === cancelValue) throw new PromptCancelled()
            if (action === customVersionValue) return false
        }
    }
}

async function promptCustomFrameworkVersion(registryClient: FrameworkRegistryClient, registryUrl: string,): Promise<FrameworkVersionSelectionCandidate | false> {
    while (true) {
        let version
        try {
            version = await requiredText("Custom Arrange framework version", {
                placeholder: "e.g 1.0.0",
                validate: validateSemver,
            })
        } catch (error) {
            if (error instanceof PromptCancelled) {
                log.info("Custom version input has been cancelled.")
                return false
            }

            throw error
        }

        while (true) {
            const checking = spinner()
            checking.start(`Checking your ${version}...`)

            try {
                const candidate = await registryClient.fetchCandidateByVersion(version, registryUrl)
                assertFrameworkCompatible(candidate)

                checking.stop(`${candidate.version} is compatible.`)
                return {...candidate, incompatibility: null}
            } catch (error) {
                checking.error(`Cannot verify ${version}.`)
                log.error(formatError(error))

                const action = await select({
                    message: "How should this custom version be handled?",
                    options: [
                        {label: "Retry checking this version", value: retryValue},
                        {label: "Enter another version", value: enterAnotherVersionValue},
                        {label: "Skip verification and use this version", value: skipVerificationValue},
                        {label: "Cancel custom version", value: cancelValue},
                    ],
                })

                if (isCancel(action) || action === cancelValue) return false
                else if (action === retryValue) continue
                else if (action === enterAnotherVersionValue) break

                log.warn(`Using unverified @arrange/framework@${version}. Later sync/install may fail if this version does not exist or is incompatible.`)
                return {
                    version,
                    cliCompatibility: cliCompatibility, // TIPS：认为它以兼容
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

        return {label, value: candidate.incompatibility === null ? candidate.version : `disabled:${index}`, hint, disabled: candidate.incompatibility !== null,}
    })
}

function hasCandidateVersion(candidates: readonly FrameworkVersionCandidate[], version: string): boolean {
    return candidates.some((candidate) => candidate.version === version)
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
