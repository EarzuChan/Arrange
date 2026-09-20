import { type IsKeyValues, extend, isFunction } from '@arrange/vue-shared'
import type { SetupContext } from './arrangable.ts'
import { type ArrangableOptions, type ArrangableOptionsBase, type RenderFunction, validateArrangableOptions } from './arrangableOptions.ts'
import type { ArrangableObjectPropsOptions, ArrangablePropsOptions, ExtractDefaultPropTypes, ExtractPropTypes } from './arrangableProps.ts'
import type { ArrangablePublicInstance, ArrangablePublicInstanceConstructor } from './arrangablePublicInstance.ts'
import type { SlotsType } from './arrangableSlots.ts'
import type { VNodeProps } from './vnode.ts'

export type PublicProps = VNodeProps
type ResolveProps<P> = Readonly<P extends ArrangablePropsOptions ? ExtractPropTypes<P> : P>

export type DefineArrangable<PropsOrPropOptions = {}, RawBindings = {}, Defaults = ExtractDefaultPropTypes<PropsOrPropOptions>, S extends SlotsType = {}, Props = ResolveProps<PropsOrPropOptions>> = ArrangablePublicInstanceConstructor<ArrangablePublicInstance<Props, RawBindings, PublicProps, Defaults, true, S>> & ArrangableOptionsBase<Props, RawBindings, S>

export type DefineSetupFnArrangable<P extends Record<string, any>, S extends SlotsType = SlotsType> = new (props: P & PublicProps) => ArrangablePublicInstance<P, {}, PublicProps, {}, false, S>

export function defineArrangable<Props extends Record<string, any>, S extends SlotsType = {}>(setup: (props: Props, ctx: SetupContext<S>) => RenderFunction | Promise<RenderFunction>, options?: Pick<ArrangableOptions, 'name'> & { props?: (keyof NoInfer<Props>)[] | ArrangableObjectPropsOptions<Props>; slots?: S }): DefineSetupFnArrangable<Props, S>

export function defineArrangable<
    TypeProps,
    RuntimePropsOptions extends ArrangableObjectPropsOptions = ArrangableObjectPropsOptions,
    RuntimePropsKeys extends string = string,
    SetupBindings = {},
    S extends SlotsType = {},
    const SlotNames extends readonly string[] = readonly [],
    InferredProps = IsKeyValues<TypeProps> extends true ? TypeProps : string extends RuntimePropsKeys ? ArrangableObjectPropsOptions extends RuntimePropsOptions ? {} : ExtractPropTypes<RuntimePropsOptions> : { [Key in RuntimePropsKeys]?: any },
>(options: {
    props?: (RuntimePropsOptions & ThisType<void>) | RuntimePropsKeys[]
    __typeProps?: TypeProps
    slotNames?: SlotNames
} & ArrangableOptionsBase<Readonly<InferredProps>, SetupBindings, S> & ThisType<ArrangablePublicInstance<InferredProps, SetupBindings, {}, {}, false, S>>): DefineArrangable<InferredProps, SetupBindings, ExtractDefaultPropTypes<RuntimePropsOptions>, S> & { readonly slotNames: SlotNames }

export function defineArrangable(options: unknown, extraOptions?: object): any {
    const arrangable = (isFunction(options) ? extend({ name: options.name }, extraOptions, { setup: options }) : options) as ArrangableOptions
    validateArrangableOptions(arrangable)
    return arrangable
}
