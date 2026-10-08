export const EMPTY_OBJ: { readonly [key: string]: any } = __DEV__ ? Object.freeze({}) : {}

export const NOOP = (): void => { }

// 作为解析器默认判定函数
export const NO = () => false

export const extend: typeof Object.assign = Object.assign

export const remove = <T>(arr: T[], el: T): void => {
    const i = arr.indexOf(el)

    if (i > -1) arr.splice(i, 1)
}

const hasOwnProperty = Object.prototype.hasOwnProperty

export const hasOwn = (val: object, key: string | symbol): key is keyof typeof val => hasOwnProperty.call(val, key)

export const isArray: typeof Array.isArray = Array.isArray

export const isMap = (val: unknown): val is Map<any, any> => toTypeString(val) === '[object Map]'

export const isSet = (val: unknown): val is Set<any> => toTypeString(val) === '[object Set]'

export const isFunction = (val: unknown): val is Function => typeof val === 'function'

export const isString = (val: unknown): val is string => typeof val === 'string'

export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'

export const isObject = (val: unknown): val is Record<any, any> => val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
    return ((isObject(val) || isFunction(val)) && isFunction((val as any).then) && isFunction((val as any).catch))
}

export const objectToString: typeof Object.prototype.toString = Object.prototype.toString

export const toTypeString = (value: unknown): string => objectToString.call(value)

export const toRawType = (value: unknown): string => {
    return toTypeString(value).slice(8, -1)
}

export const isPlainObject = (val: unknown): val is object => toTypeString(val) === '[object Object]'

export const isIntegerKey = (key: unknown): boolean => isString(key) && key !== 'NaN' && key[0] !== '-' && '' + parseInt(key, 10) === key

const cacheStringFunction = <T extends (str: string) => string>(fn: T): T => {
    const cache: Record<string, string> = Object.create(null)

    return ((str: string) => {
        const hit = cache[str]

        return hit || (cache[str] = fn(str))
    }) as T
}

const camelizeRE = /-\w/g
export const camelize: (str: string) => string = cacheStringFunction((str: string): string => {
    return str.replace(camelizeRE, c => c.slice(1).toUpperCase())
}
)

export const capitalize: <T extends string>(str: T) => Capitalize<T> = cacheStringFunction(<T extends string>(str: T) => { return (str.charAt(0).toUpperCase() + str.slice(1)) as Capitalize<T> })


export const hasChanged = (value: any, oldValue: any): boolean => !Object.is(value, oldValue)

export const def = (obj: object, key: string | symbol, value: any, writable = false): void => {
    Object.defineProperty(obj, key, {
        configurable: true,
        enumerable: false,
        writable,
        value,
    })
}

const identRE = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/

export function genPropsAccessExp(name: string): string {
    return identRE.test(name) ? `__props.${name}` : `__props[${JSON.stringify(name)}]`
}

export function genCacheKey(source: string, options: any): string {
    return (source + JSON.stringify(options, (_, val) => typeof val === 'function' ? val.toString() : val))
}
