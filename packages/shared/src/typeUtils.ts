export type Prettify<T> = { [K in keyof T]: T[K] } & {}

export type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N
