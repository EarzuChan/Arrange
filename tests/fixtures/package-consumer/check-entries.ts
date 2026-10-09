import * as core from '@arrange/framework'
import { Text, FlowRow, FlowColumn, LazyColumn, LazyRow, LazyVerticalGrid, LazyHorizontalGrid } from '@arrange/framework/foundation'
import { M, Modifier, IntrinsicSize, GridCells, GridItemSpan } from '@arrange/framework/ui'
import { animatedNumberAsRef, tween, repeatable } from '@arrange/framework/animation'
import { ref as internalRef } from '@arrange/framework/internal'

const focusManagerKey: core.InjectionKey<core.FocusManager> = core.FocusManagerKey
const consumeFocusManager = (): core.FocusManager | undefined => core.inject(focusManagerKey)

if (core.ref !== internalRef || !(M instanceof Modifier) || !Text) throw new Error('发布包分层入口的运行时身份不一致')
if (typeof animatedNumberAsRef !== 'function' || tween().kind !== 'tween') throw new Error('发布包动画入口缺少正式能力')
if (![FlowRow, FlowColumn, LazyColumn, LazyRow, LazyVerticalGrid, LazyHorizontalGrid].every(Boolean) || typeof core.createLazyState !== 'function' || typeof core.createFocusRequester !== 'function') throw new Error('发布包缺少 M3 布局或焦点入口')
if (typeof focusManagerKey !== 'symbol' || typeof consumeFocusManager !== 'function' || 'useFocusManager' in core || 'createNativeFocusManager' in core) throw new Error('发布包焦点管理器必须通过正式 InjectionKey 消费')
if (GridCells.Fixed(3).count !== 3 || GridItemSpan(2).count !== 2 || IntrinsicSize.Min !== 'IntrinsicSize.Min' || repeatable({ iterations: 2, animation: tween() }).kind !== 'repeatable') throw new Error('发布包 M3 基础类型或动画契约错误')
if (M.drawBehind(scope => scope.drawRect({ color: 0xff112233 })).elements[0].type !== 'drawBehind') throw new Error('发布包缺少 typed 绘制 Modifier')
