import { isAbsolute, relative, sep } from 'node:path'
import type { ViteDevServer } from 'vite'

export function bindPublicResourceReload(server: ViteDevServer): () => void {
    const publicDirectory = server.config?.publicDir
    if (!publicDirectory || !server.watcher) return () => { }
    const watcher = server.watcher
    const socket = server.ws
    const httpServer = server.httpServer

    const reload = (file: string): void => {
        const path = relative(publicDirectory, file)
        if (!path || isAbsolute(path) || path === '..' || path.startsWith('..' + sep)) return
        socket.send({ type: 'full-reload', path: '*' })
    }
    const events = ['change', 'add', 'unlink'] as const
    for (const event of events) watcher.on(event, reload)

    const release = () => {
        for (const event of events) watcher.off(event, reload)
        httpServer?.off('close', release)
    }
    httpServer?.once('close', release)
    return release
}
