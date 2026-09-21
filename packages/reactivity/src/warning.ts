export function warn(msg: string, ...args: any[]): void {
    console.warn(`[Arrange 警告] ${msg}`, ...args)
}