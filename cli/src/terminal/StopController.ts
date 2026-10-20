import type { SessionDocument } from './SessionDocument.ts'
import type { StopControl } from '../util/StopControl.ts'

// 正常结束只影响当前运行阶段，不取消整个命令；收尾期间重复按键仍由此作用域消费
export class StopController {
    private current?: { readonly document: SessionDocument, readonly controller: AbortController, state: 'preparing' | 'running' | 'stopping' }
    constructor(private readonly changed: () => void) { }

    async run<T>(document: SessionDocument, hint: string, body: (control: StopControl) => Promise<T>): Promise<T> {
        document.assertActive()
        if (this.current) throw new Error('不能同时打开两个正常结束作用域')
        const scope = { document, controller: new AbortController(), state: 'preparing' as 'preparing' | 'running' | 'stopping' }
        this.current = scope
        const update = (state: 'running' | 'stopping') => {
            if (this.current !== scope) throw new Error('正常结束作用域已结束')
            document.assertActive()
            if (scope.state === 'stopping' && state === 'running') throw new Error('收尾后不能重新开放正常结束')
            scope.state = state
            document.stopHint = state === 'running' ? hint : undefined
            this.changed()
        }
        try {
            return await body(Object.freeze({ signal: scope.controller.signal, enable: () => update('running'), disable: () => update('stopping') }))
        } finally {
            document.stopHint = undefined
            this.current = undefined
            this.changed()
        }
    }

    request(): boolean {
        const scope = this.current
        if (!scope || scope.state === 'preparing') return false
        if (scope.state === 'running') {
            scope.state = 'stopping'
            scope.document.stopHint = undefined
            scope.controller.abort(new DOMException('用户请求正常结束', 'AbortError'))
            this.changed()
        }
        return true
    }
}
