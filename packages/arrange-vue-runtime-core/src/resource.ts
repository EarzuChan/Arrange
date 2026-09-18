// 编译生成的资源输入携带来源，供原生发布前的资源准备报告错误
export function arrangeResource(value: unknown, origin?: string): {path: string; origin?: string} | {url: string; origin?: string} | null {
    if (value == null) return null
    if (typeof value === 'string') return {path: value, origin}

    if (typeof value === 'object') {
        const resource = value as {path?: unknown; url?: unknown; origin?: string}
        const source = resource.origin ?? origin
        if (typeof resource.path === 'string' && resource.url == null) return {path: resource.path, origin: source}
        if (typeof resource.url === 'string' && resource.path == null) return {url: resource.url, origin: source}
    }

    throw new TypeError(`资源输入必须是路径字符串、{path} 或 {url}${origin ? `\n来源：${origin}` : ''}`)
}
