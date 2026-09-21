import { LRUCache } from 'lru-cache'

export function createCache<T extends {}>(max = 500): Map<string, T> | LRUCache<string, T> {
    /* v8 ignore next 3 */

    return new LRUCache({ max })
}