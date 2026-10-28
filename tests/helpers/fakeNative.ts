import type { NativeTransactionTarget } from '../../packages/framework/src/native.ts'
import { ARRANGE_RUNTIME_VERSION } from '../../packages/framework/src/native.ts'

// 补齐真实宿主必然提供的全部成员，测试按需覆盖；interop 仅在传入时出现
export function createFakeNative(overrides: Partial<NativeTransactionTarget> = {}): NativeTransactionTarget {
    let handle = 1n
    return {
        focusCommand: () => false,
        installFrameDriver: () => { },
        installLayoutDriver: () => { },
        continueRearrange: () => { },
        currentTime: () => 0,
        requestFrame: () => { },
        beginRearrange: () => { },
        submitRearrange: complete => complete(),
        abortRearrange: () => { },
        acquirePainter: () => ({ identity: handle++, generation: 1n }),
        releasePainter: () => { },
        registerBinding: () => ({ identity: handle++, generation: 1n }),
        updateBinding: () => { },
        releaseBinding: () => { },
        modifierInstances: () => [],
        registerModifierBinding: () => ({ identity: handle++, generation: 1n }),
        runtimeVersion: ARRANGE_RUNTIME_VERSION,
        createNode: () => { },
        deleteNode: () => { },
        insertChild: () => { },
        removeChild: () => { },
        unmount: () => { },
        log: () => { },
        diagnosticsToast: () => { },
        diagnosticsRequestReload: () => { },
        diagnosticsTriggerFakeError: () => { },
        diagnosticsSetToastsEnabled: () => { },
        ...overrides,
    }
}
