type WarningHandler = (message: string, details: readonly unknown[]) => void

let warningHandler: WarningHandler | undefined

export function setWarningHandler(handler: WarningHandler | undefined): void {
    warningHandler = handler
}

export function warn(msg: string, ...args: any[]): void {
    warningHandler?.(msg, args)
}
