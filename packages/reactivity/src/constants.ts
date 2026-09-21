// using literal strings instead of numbers so that it's easier to inspect
// debugger events

export enum TrackOpTypes {
    GET = 'get',
    HAS = 'has',
    ITERATE = 'iterate',
}

export enum TriggerOpTypes {
    SET = 'set',
    ADD = 'add',
    DELETE = 'delete',
    CLEAR = 'clear',
}

export enum ReactiveFlags {
    SKIP = '__arrange_skip',
    IS_REACTIVE = '__arrange_isReactive',
    IS_READONLY = '__arrange_isReadonly',
    IS_SHALLOW = '__arrange_isShallow',
    RAW = '__arrange_raw',
    IS_REF = '__arrange_isRef',
}