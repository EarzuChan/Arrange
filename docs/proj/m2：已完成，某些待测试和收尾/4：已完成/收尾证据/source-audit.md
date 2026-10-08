# M2.4 源码删除与入口审计

日期：2026-10-08。范围：`packages/`、`native/`、`demo/`、`types/` 的生产源码、包清单与实际入口。此记录补充退出条件 §11 中功能测试不能证明的删除项；不以搜索结果替代原生集成验收。

## 清理结果

本次审计发现并清除以下确证没有调用的残余，未删除正常算法、类型化值解码或版权说明：

| 删除项 | 无消费者证据与保留边界 |
| --- | --- |
| `packages/shared/index.js`、`packages/reactivity/index.js` | 旧 CJS stub 引用不存在的 `dist/*.cjs`；全仓引用搜索只有文件自身，现有 exports、files 和打包源均指向 `src/`。 |
| `Paint.cpp` 的 7 个 local helper | `inputValue`、`inputPlaceholder`、`numericProp`、两个 `textProp`、`hasProp`、`hasColorUnspecified` 只有定义，没有调用；移除因此无用的 `PropValue.h` include。 |
| `Layout.cpp` 的 `nodeAlignmentProp` | 只有定义，没有调用；移除因此无用的 include。正式 `alignModifier` 与 Modifier parent data 保留。 |
| `PropValue.h/.cpp` 的 9 个 LayoutNode props 访问工具 | `propValue(LayoutNode…)`、`hasProp`、`objectProp`、两个 `stringProp`、`numberProp`、`intProp`、`boolProp`、`colorProp` 只在这一组内相互引用；声明、定义、LayoutNode 前置声明/include 一并删除。 |
| `errorHandling.ts` 的 8 个闲置错误标签 | `SETUP_FUNCTION`、`STRUCTURE_FUNCTION`、`NATIVE_EVENT_HANDLER`、`TRANSITION_HOOK`、`APP_ERROR_HANDLER`、`APP_WARN_HANDLER`、`ASYNC_ARRANGABLE_LOADER`、`APP_UNMOUNT_CLEANUP` 无生产或测试引用。现有消费者只使用 `SCHEDULER` 与 `ARRANGABLE_UPDATE`，明确保留原数值 10、11。 |

`PropValue`、`PropObject`、`kebabCase` 以及 `QuickJsValueReader::propValue(JSValue…)` 保留。后者是正式 typed JSValue 解码器，和删除的旧 LayoutNode 读值 helper 不同。宿主的 `enabled`、辅助功能信息与 MeasurePolicy typed 值也保留。

## 删除条件复核

2026-10-09 按主人口径追加检查：移除 templateContract 对 ref/refFor/refKey 的专用黑名单，参数统一按目标声明处理；移除 module-snapshot 对 CSS 类扩展名的专用黑名单，模块经过实际 Vite 转换与 JS 解析链路。parser 同时删除 @ 事件、.prop 简写、a-on 语句模式和 template-lang 预处理分支。当前语法集合、参数类型、typed 输入与身份校验保留。测试和验收口径见 [测试策略](../../../../arch/22-测试策略.md)。

同日清理自有源码的英文说明、块注释和生成注释标记。SFA 单位、颜色及参数转换改用编译器类型化契约，绑定正式模块导出的真实声明身份；不依赖源码注释或局部函数拼写。数值单位后缀以空格归一并还原源码位置；编译期开关类型随真实初始化模块进入安装包，不依赖仓库专用声明入口。许可与上游来源保留在 LICENSE/UPSTREAM.md，第三方原始代码未改。代码注释规则见 [开发约束](../../../5：具体开发的额外约束.md)，SFA 与原始 TS 的写法区别见 [SFA 母文档](../../../../arch/33-SFA与模板写法.md)。

| 退出条件 | 源码结论 |
| --- | --- |
| VNode、`h/createVNode/cloneVNode`、旧 diff/patch/renderer 桥 | 生产源码无这些类型、函数或兼容桥。唯一同名 `createBlock` 是 `compiler/src/sfa/parse.ts` 构造 `SFABlock` 的 parser helper，不是渲染节点。运行时 `RearrangeScope` 保存已建立调用/作用域账本；编译器生成直接调用程序。 |
| Teleport/Suspense/Vue Transition、ArrangeLocal、旧 rAF 及其全局安装 | 无生产入口或实现。保留 Arrange 自有 `createTransition/createInfiniteTransition`、AnimatedVisibility/Crossfade，以及统一帧宿主的 `installFrameDriver/currentTime/requestFrame`。QuickJS 当前安装正式宿主、performance 与开发热更新 transport，没有浏览器 rAF 桥。 |
| TextMeasurePolicy、旧宿主文本旁路 | 无旧策略或旧文本创建入口。Text/Input 使用 `.text/.textField` Modifier，内层 Layout 使用 MinSizeMeasurePolicy；当前 HostInput 白名单仅 `measurePolicy/contentDescription/label/description/role/enabled`。本轮清除不可达的旧 `value/placeholder` 读值 helper。 |
| 非 Layout 创建 RearrangeNode | TS 全仓唯一实例化是 `arrangable/Layout.ts` 的 `new LayoutRearrangeNode(instance, host)`。普通 FA 组合 Layout、Policy、Modifier 与内容；宿主根 Root 是应用承载实体。native 类型仅 Root/Layout/Unknown，创建入口只接受内部 Root/LayoutNode。 |
| FA 名称特判或隐藏能力注册表 | renderer、runtime、native 无按普通 FA 名称赋权或创建节点的分派。App 的 foundation 默认定义表是普通名称解析，用户可经同一 `arrangable()` 注册；`defineArrangable` 的通用 WeakSet 验证所有定义身份，不授予 FA 原生权限。MeasurePolicy 的 Box/Row/Column 是明确策略判别值，Modifier 方法缓存检查正式方法身份，均不是 FA 能力暗门。 |
| 旧公开包名与 Compose 命名 | 生产导入/导出只使用当前五个 `@arrange/*` 内部包和 framework 分层入口；没有旧公开包兼容别名。保留 JUCE/IME 的 composition、composing、选区和光标术语，以及上游 MIT/Vue 来源记录与历史文档。 |

原生 DrawOps 的 `PassivePaintRenderer`、正式 `TextPresentation/textPresentation()`、typed mutation 与 slot update 均属于当前协议，不应按 renderer/text 字样误删。QuickJS 直接读取 JSValue；core/QuickJS 未发现通过 JSON 序列化提交 UI mutation 的旁路。节点代际、BindingHandle、ModifierHandle 和输入会话身份校验仍在正式链路中。

## 入口依赖证据

使用 TypeScript AST 从入口递归检查值 import/re-export、side-effect import 和静态字符串 import()/require()；显式 type-only 边不计入，按 `tsconfig.json` aliases 和源文件解析。未做 tree shaking，因此结果是保守的源码可达图，所有本地边均成功解析。

五个内部包确为 framework、reactivity、shared、compiler、vite-plugin。五个用户入口为核心、foundation、ui、animation、vite；`internal` 是额外的编译器/宿主协议入口，不作为第六个用户稳定 API。

| 入口 | 可达源模块数 | 可达内部包 | 外部构建依赖 |
| --- | ---: | --- | --- |
| framework 核心 | 64 | framework/reactivity/shared | 无 |
| framework/foundation | 60 | framework/reactivity/shared | 无 |
| framework/ui | 52 | framework/reactivity/shared | 无 |
| framework/animation | 58 | framework/reactivity/shared | 无 |
| framework/internal | 53 | framework/reactivity/shared | 无 |
| framework/vite | 93 | 全部五包 | 有，仅此用户入口 |
| reactivity | 22 | reactivity/shared | 无 |
| shared | 9 | shared | 无 |
| compiler SFA | 39 | compiler/shared | 有，工具包 |
| compiler/template | 25 | compiler/shared | 有，工具包 |
| vite-plugin | 92 | 全部五包 | 有，工具包 |

工具链可达的外部模块为 `@babel/parser`、`entities/decode`、`estree-walker`、`lru-cache`、`magic-string`、`source-map-js`、`typescript`、`vite` 及 Node 内建模块。compiler 的 foundation 导入文本用于静态类型分析，不是用户运行时执行边。framework 清单同时承载运行时与构建依赖；不能把清单中所有 dependencies 当作核心入口的运行时可达依赖。

## 换行与局部检查

此前 native 格式修正中的 25 个 EOL-only 文件，在本次结束时逐一与格式前字节备份比较：仅归一 CRLF/LF 后全部正文一致，`git diff --numstat -- <这25文件>` 输出为空，不产生不必要内容 diff。其余 10 个空白/折行修正及 175 文件格式检查记录见 [native-format.txt](native-format.txt)。

本轮 4 个修改过的 C++ 文件（Paint.cpp、Layout.cpp、PropValue.cpp、PropValue.h）使用仓库 `.clang-format` 和 clang-format 22 `--dry-run --Werror` 全部通过；errorHandling.ts 使用正式 `scripts/format-code.ts` 检查通过，0 文件需调整；修改文件 `git diff --check` 通过。没有运行测试、构建或常驻进程；最终增量 native 构建、CTest 与全仓 TS 验收由总收尾统一执行。
