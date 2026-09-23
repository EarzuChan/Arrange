import { reactive } from '@arrange/reactivity'
import type { InjectionKey } from './runtime/apiInject.ts'

export interface Density {
    dpToPx(value: number): number
    
    spToPx(value: number): number
    
    pxToDp(value: number): number
    
    pxToSp(value: number): number
}

export const DensityKey: InjectionKey<Density> = Symbol('Arrange.Density') // 建立一个单独内建keys文件，并移动这个过去

export function createDensity(dpScale = 1, spScale = 1): Density & { dpScale: number; spScale: number } {
    const state = reactive({ dpScale: scale(dpScale), spScale: scale(spScale) })

    return {
        get dpScale() { return state.dpScale },
        set dpScale(value: number) { state.dpScale = scale(value) },

        get spScale() { return state.spScale },
        set spScale(value: number) { state.spScale = scale(value) },

        dpToPx: value => convert(value, state.dpScale),
        spToPx: value => convert(value, state.spScale),

        pxToDp: value => convert(value, 1 / state.dpScale),
        pxToSp: value => convert(value, 1 / state.spScale),
    }
}

function scale(value: number): number {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Density 倍率必须是正有限数值')
    return value
}

function convert(value: number, factor: number): number {
    const result = value * factor
    if (typeof value !== 'number' || !Number.isFinite(result)) throw new TypeError('单位转换需要有限数值，SFA 值壳必须先经过编译')
    return result
}