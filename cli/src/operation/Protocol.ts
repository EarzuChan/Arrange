import type { ProcessResult, ProcessSpec } from "../platform/ProcessSpec.ts"
import type { Resource } from "./Resource.ts"

export type WireProcess = Omit<ProcessSpec, "signal" | "onOutput" | "onOutputEnd">
export type WorkerRequest =
    | { readonly kind: "acquire", readonly id: string, readonly label: string, readonly resources: readonly Resource[], readonly observe: boolean }
    | { readonly kind: "release" | "cancel", readonly id: string }
    | { readonly kind: "start", readonly id: string, readonly process: WireProcess }
    | { readonly kind: "close", readonly id: string }
export type WorkerResponse =
    | { readonly kind: "ready" }
    | { readonly kind: "ok", readonly id: string }
    | { readonly kind: "error", readonly id: string, readonly message: string, readonly name: string }
    | { readonly kind: "waiting", readonly id: string, readonly message: string }
    | { readonly kind: "output", readonly id: string, readonly channel: "stdout" | "stderr", readonly bytes: string }
    | { readonly kind: "result", readonly id: string, readonly result: ProcessResult }
