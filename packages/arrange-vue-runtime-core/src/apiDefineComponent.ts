import { type IsKeyValues, extend, isFunction } from '@arrange/vue-shared'
import type { ComponentTypeEmits } from './apiSetupHelpers.ts'
import type { AllowedComponentProps, ComponentCustomProps, SetupContext } from './component.ts'
import type { EmitsOptions, EmitsToProps, TypeEmitsToOptions } from './componentEmits.ts'
import { type ComponentOptions, type ComponentOptionsBase, type RenderFunction, validateComponentOptions } from './componentOptions.ts'
import type { ComponentObjectPropsOptions, ComponentPropsOptions, ExtractDefaultPropTypes, ExtractPropTypes } from './componentProps.ts'
import type { ComponentPublicInstance, ComponentPublicInstanceConstructor } from './componentPublicInstance.ts'
import type { SlotsType } from './componentSlots.ts'
import type { VNodeProps } from './vnode.ts'

export type PublicProps = VNodeProps & AllowedComponentProps & ComponentCustomProps
type ResolveProps<P, E extends EmitsOptions> = Readonly<P extends ComponentPropsOptions ? ExtractPropTypes<P> : P> & ({} extends E ? {} : EmitsToProps<E>)

export type DefineComponent<PropsOrPropOptions = {}, RawBindings = {}, E extends EmitsOptions = {}, Defaults = ExtractDefaultPropTypes<PropsOrPropOptions>, S extends SlotsType = {}, Props = ResolveProps<PropsOrPropOptions, E>> = ComponentPublicInstanceConstructor<ComponentPublicInstance<Props, RawBindings, E, PublicProps, Defaults, true, S>> & ComponentOptionsBase<Props, RawBindings, E, S>

export type DefineSetupFnComponent<P extends Record<string, any>, E extends EmitsOptions = {}, S extends SlotsType = SlotsType> = new (props: P & EmitsToProps<E> & PublicProps) => ComponentPublicInstance<P & EmitsToProps<E>, {}, E, PublicProps, {}, false, S>

export function defineComponent<Props extends Record<string, any>, E extends EmitsOptions = {}, S extends SlotsType = {}>(setup: (props: Props, ctx: SetupContext<E, S>) => RenderFunction | Promise<RenderFunction>, options?: Pick<ComponentOptions, 'name' | 'inheritAttrs'> & { props?: (keyof NoInfer<Props>)[] | ComponentObjectPropsOptions<Props>; emits?: E; slots?: S }): DefineSetupFnComponent<Props, E, S>

export function defineComponent<
    TypeProps,
    RuntimePropsOptions extends ComponentObjectPropsOptions = ComponentObjectPropsOptions,
    RuntimePropsKeys extends string = string,
    TypeEmits extends ComponentTypeEmits = {},
    RuntimeEmitsOptions extends EmitsOptions = {},
    SetupBindings = {},
    S extends SlotsType = {},
    ResolvedEmits extends EmitsOptions = {} extends RuntimeEmitsOptions ? TypeEmitsToOptions<TypeEmits> : RuntimeEmitsOptions,
    InferredProps = IsKeyValues<TypeProps> extends true ? TypeProps : string extends RuntimePropsKeys ? ComponentObjectPropsOptions extends RuntimePropsOptions ? {} : ExtractPropTypes<RuntimePropsOptions> : { [Key in RuntimePropsKeys]?: any },
>(options: {
    props?: (RuntimePropsOptions & ThisType<void>) | RuntimePropsKeys[]
    __typeProps?: TypeProps
    __typeEmits?: TypeEmits
} & ComponentOptionsBase<Readonly<InferredProps> & Readonly<EmitsToProps<ResolvedEmits>>, SetupBindings, RuntimeEmitsOptions, S> & ThisType<ComponentPublicInstance<InferredProps, SetupBindings, ResolvedEmits, {}, {}, false, S>>): DefineComponent<InferredProps, SetupBindings, ResolvedEmits, ExtractDefaultPropTypes<RuntimePropsOptions>, S>

export function defineComponent(options: unknown, extraOptions?: object): any {
    const component = (isFunction(options) ? extend({ name: options.name }, extraOptions, { setup: options }) : options) as ComponentOptions
    validateComponentOptions(component)
    return component
}
