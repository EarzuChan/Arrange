import { confirm, isCancel, select } from '../../terminal/Prompts.ts'
import { cliCompatibility, frameworkVerificationConcurrency } from '../../CliMetadata.ts'
import type { FrameworkService, FrameworkSelectionInput, VerifiedFrameworkVersion } from '../../feature/framework/FrameworkService.ts'
import type { FrameworkVersionSelectionCandidate } from '../../feature/framework/FrameworkMamba.ts'
import { RegistryUnreachableError } from '../../feature/framework/FrameworkErrors.ts'
import { SourceUnavailableError } from '../../feature/source/GitSource.ts'
import type { TaskOutput } from '../../feature/operation/Work.ts'
import { PromptCancelled, requiredText, validateSemver } from '../PromptUtils.ts'
import { errorMessage, formatTimestampToDate } from '../../util/Utils.ts'
import { isAbortError } from '../../feature/platform/ProcessSpec.ts'
import type { CommandInterface } from '../CommandInterface.ts'
import type { PresentationRegion } from '../../terminal/Presentation.ts'
import { interactionStep } from '../InteractionStep.ts'

export interface FrameworkVersionWizardInput extends FrameworkSelectionInput { readonly suggestion?: string }

type Verification = { readonly kind: 'pending' } | { readonly kind: 'ready', readonly verified: VerifiedFrameworkVersion } | { readonly kind: 'unavailable' | 'rejected', readonly reason: string }
interface Candidate {
    readonly version: string
    readonly metadata?: FrameworkVersionSelectionCandidate
    readonly custom: boolean
    verification: Verification
}

const customVersionValue = 'custom'
const retryValue = 'retry'
const refreshValue = 'refresh'
const viewResultsValue = 'view-results'
const editValue = 'edit'
const backValue = 'back'
const cancelValue = 'cancel'

export async function selectFrameworkVersion(terminal: CommandInterface, framework: FrameworkService, input: FrameworkVersionWizardInput = {}): Promise<VerifiedFrameworkVersion> {
    return interactionStep(terminal, region => runSelection(region, framework, input), selected => ({ question: 'Arrange Framework 版本', answer: selected.version }))
}

async function runSelection(region: PresentationRegion<CommandInterface>, framework: FrameworkService, input: FrameworkVersionWizardInput): Promise<VerifiedFrameworkVersion> {
    const candidates: Candidate[] = []
    let preferred = input.suggestion && !validateSemver(input.suggestion) ? input.suggestion : undefined
    if (preferred) candidates.push({ version: preferred, custom: true, verification: { kind: 'pending' } })
    await refreshCandidates(region, framework, input, candidates)

    while (true) {
        const terminal = region.replace()
        const selected = await select({
            ...terminal.prompt,
            message: `选择 Arrange Framework 版本（CLI 兼容契约 ${cliCompatibility}）`,
            initialValue: preferred,
            options: [
                ...candidates.map(candidateOption),
                { label: '自定义版本', value: customVersionValue },
                ...(candidates.some(candidate => candidate.verification.kind === 'unavailable') ? [{ label: '重试暂时无法验证的版本', value: retryValue }] : []),
                { label: '刷新版本列表', value: refreshValue },
                { label: '取消版本选择', value: cancelValue },
            ],
        })
        if (isCancel(selected) || selected === cancelValue) throw new PromptCancelled()
        if (selected === refreshValue) await refreshCandidates(region, framework, input, candidates)
        else if (selected === retryValue) await verifyCandidates(region, framework, input, candidates.filter(candidate => candidate.verification.kind === 'unavailable'))
        else if (selected === customVersionValue) preferred = await addCustomVersion(region, framework, input, candidates) ?? preferred
        else {
            const candidate = candidates.find(candidate => candidate.version === selected)
            if (candidate?.verification.kind !== 'ready') throw new Error('所选 Framework 不是已验证的候选版本')
            preferred = candidate.version
            const accepted = await confirm({ ...region.replace().prompt, message: `确认使用 Arrange Framework ${candidate.version}？`, initialValue: true, active: '是', inactive: '否' })
            if (isCancel(accepted)) throw new PromptCancelled()
            if (accepted) return candidate.verification.verified
        }
    }
}

async function refreshCandidates(region: PresentationRegion<CommandInterface>, framework: FrameworkService, input: FrameworkSelectionInput, candidates: Candidate[]): Promise<void> {
    while (true) {
        const terminal = region.replace()
        try {
            const metadata = await terminal.tasks.status('读取 Arrange Framework 版本', () => framework.candidates(input.registryUrl))
            const custom = candidates.filter(candidate => candidate.custom && !metadata.some(item => item.version === candidate.version))
            candidates.splice(0, candidates.length, ...metadata.map(item => ({ version: item.version, metadata: item, custom: false, verification: { kind: 'pending' as const } })), ...custom.map(candidate => ({ ...candidate, verification: { kind: 'pending' as const } })))
            break
        } catch (error) {
            if (isAbortError(error)) throw error
            const action = await select({ ...terminal.prompt, message: '无法读取 Framework 版本列表', options: [{ label: '重试', value: retryValue }, { label: '取消版本选择', value: cancelValue }] })
            if (isCancel(action) || action === cancelValue) throw new PromptCancelled()
        }
    }
    await verifyCandidates(region, framework, input, candidates)
}

async function verifyCandidates(region: PresentationRegion<CommandInterface>, framework: FrameworkService, input: FrameworkSelectionInput, candidates: Candidate[]): Promise<void> {
    let pending = candidates
    while (pending.length) {
        const terminal = region.replace()
        await terminal.tasks.run({ id: 'verify-framework-candidates', title: '检查 Framework 候选版本' }, async task => {
            let next = 0, completed = 0, cancelled: unknown
            const worker = async () => {
                while (next < pending.length && !cancelled) {
                    const candidate = pending[next++]!
                    try { candidate.verification = await verifyCandidate(framework, input, candidate, task) } catch (error) {
                        cancelled = error
                        return
                    }
                    task.progress(++completed, pending.length)
                }
            }
            await Promise.all(Array.from({ length: Math.min(frameworkVerificationConcurrency, pending.length) }, worker))
            if (cancelled) throw cancelled
        })
        const unavailable = pending.filter(candidate => candidate.verification.kind === 'unavailable')
        if (!unavailable.length) return
        const feedback = region.replace()
        for (const candidate of unavailable) if (candidate.verification.kind === 'unavailable') feedback.reporter.warn(`${candidate.version}：${candidate.verification.reason}`)
        const action = await select({ ...feedback.prompt, message: '部分 Framework 版本暂时无法验证', options: [{ label: '重试暂时无法验证的版本', value: retryValue }, { label: '查看现有结果', value: viewResultsValue }, { label: '取消版本选择', value: cancelValue }] })
        if (isCancel(action) || action === cancelValue) throw new PromptCancelled()
        if (action === viewResultsValue) return
        pending = unavailable
    }
}

async function verifyCandidate(framework: FrameworkService, input: FrameworkSelectionInput, candidate: Candidate, task: TaskOutput): Promise<Verification> {
    if (!candidate.custom && candidate.metadata?.incompatibility) return { kind: 'rejected', reason: candidate.metadata.incompatibility }
    try {
        const verified = !candidate.custom && candidate.metadata ? await framework.verifyCandidate(candidate.metadata, input, task) : await framework.selectVersion(candidate.version, input, task)
        return { kind: 'ready', verified }
    } catch (error) {
        if (isAbortError(error)) throw error
        return { kind: error instanceof RegistryUnreachableError || error instanceof SourceUnavailableError ? 'unavailable' : 'rejected', reason: errorMessage(error) }
    }
}

async function addCustomVersion(region: PresentationRegion<CommandInterface>, framework: FrameworkService, input: FrameworkSelectionInput, candidates: Candidate[]): Promise<string | undefined> {
    while (true) {
        const terminal = region.replace()
        const version = await requiredText(terminal.prompt, '自定义 Arrange Framework 版本', { placeholder: '例如 1.0.0', validate: validateSemver })
        const existing = candidates.find(candidate => candidate.version === version)
        if (existing?.verification.kind === 'ready') return version
        const candidate: Candidate = { version, custom: true, verification: { kind: 'pending' } }
        while (true) {
            candidate.verification = await region.replace().tasks.run({ id: 'verify-framework-custom', title: `检查 Framework ${version}` }, task => verifyCandidate(framework, input, candidate, task))
            const index = candidates.findIndex(item => item.version === version)
            if (index < 0) candidates.push(candidate)
            else candidates[index] = { ...candidate, metadata: candidates[index]!.metadata }
            if (candidate.verification.kind === 'ready') return version
            if (candidate.verification.kind === 'pending') throw new Error('Framework 验证未产生结果')
            const feedback = region.replace()
            feedback.reporter.error(candidate.verification.reason)
            const action = await select({ ...feedback.prompt, message: `Framework ${version} 未通过验证`, options: [{ label: '重试此版本', value: retryValue }, { label: '输入其他版本', value: editValue }, { label: '返回版本列表', value: backValue }, { label: '取消版本选择', value: cancelValue }] })
            if (isCancel(action) || action === cancelValue) throw new PromptCancelled()
            if (action === backValue) return undefined
            if (action === editValue) break
        }
    }
}

function candidateOption(candidate: Candidate) {
    const { metadata, verification } = candidate
    const hint = verification.kind === 'ready' ? metadata?.publishedAt ? formatTimestampToDate(metadata.publishedAt) : '已验证' : verification.kind === 'pending' ? '等待验证' : `${verification.kind === 'unavailable' ? '暂时无法验证' : '不可用'}：${verification.reason}`
    return { label: `${metadata?.markedLatest ? 'LATEST ' : ''}${candidate.version}`, value: candidate.version, hint, disabled: verification.kind !== 'ready' }
}
