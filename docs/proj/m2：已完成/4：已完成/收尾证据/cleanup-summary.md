# M2.4 代码清理证据

2026-10-08–09，Windows，Node 24.16.0。本文记录 After M2.4 第 6 项的局部实施与后续修正；测试长期口径见 [测试策略](../../../../arch/22-测试策略.md)。

| 范围 | 删除或修复 | 保留依据 |
| --- | --- | --- |
| shared | 无调用的旧指令名单、a-model 转换、旧 whitelist 别名、数组/全局工具与类型工具 | 保留正式参数归一、单位契约及生产编译/响应式调用的纯工具 |
| compiler | 无引用的浏览器表达式校验文件；utils 的旧浏览器/指令查询辅助；无调用 NodeTransform；旧错误码、无作用选项、上游版本宏和第三方转导 | 保留真实 SFA 区块/实体扫描、Babel/TS 解析、源码映射和正式模板调用 |
| reactivity | computed.effect、Pinia _dirty 旁路、无作用递归警告字段、调试残留 | 双向依赖链、版本缓存、集合代理与暂停恢复仍被生产使用，不因上游来源删除正确算法 |
| 退休处理 | 清理抛错仍执行 onStop；先退休再清理；运行中停止后不重新订阅，并恢复旧 activeLink、释放依赖链 | 验证重复停止、错误聚合、旧/新/未再读取依赖的订阅计数，以及 App 结构中自行卸载后的读取 |
| 模板定位 | 多行表达式标识符的位置基于完整原始表达式计算 | 真实 parser/transform 验证第三行的标识符行、列及 offset |
| 工具版本 | Vite 插件通过 framework/internal 读取正式 Arrange 版本；删除 __VERSION__ 上游宏 | 版本仍由 arrange.version.json 生成，不复制新版本数字；正式包入口可供 staging 消费 |
| 测试 | m24-contract 与 rearrange-sfa 共用正式编译求值器；验证核心响应式、App 退休、源码位置和当前 SFA 契约，删除针对旧 API 与旧词汇的拒绝断言 | Node 记录目标只验证 TS 提交/调度；布局、绘制与真实宿主结论仍需 QuickJS/native 和主人验收 |
| 注释与编译 | 清除自有代码英文说明和块注释；单位、颜色及函数参数规则移入编译器类型化契约，按正式声明身份识别；数值后缀用空格归一，不插入注释标记 | SFA 保留模板与脚本特色值转换、模板 Ref 解包；普通 TS 维持原始写法；正向编译运行和原生消费者复验 |
| 来源 | 补 compiler/shared/reactivity 的上游许可与来源记录，staging 复制 LICENSE/UPSTREAM.md | 保留实际衍生代码的上游版权；不把退出兼容行为冒充抹除来源 |

证据：

- [cleanup-retirement.txt](cleanup-retirement.txt)：10 月 8 日的核心响应式和 value-binding 局部验证，共 24 项通过
- [cleanup-coverage.txt](cleanup-coverage.txt)：五个相关测试文件共 92 项通过，0 失败
- [cleanup-format.txt](cleanup-format.txt)：10 月 8 日的局部格式检查，26 个触碰文件通过；最终全仓检查见 [工程验证](engineering.txt)

覆盖率命令采用 Node `--experimental-test-coverage`，统计 `packages/compiler/src/**/*.ts`、`packages/shared/src/**/*.ts`、`packages/reactivity/src/**/*.ts` 中本次实际加载的模块。测试文件为 reactivity-core、vite-plugin、m24-contract、rearrange-sfa 和 value-binding；没有统计 Framework、CLI、C++ 或未加载模块。最终 92 项测试全部通过，实际分母为 53 个模块（compiler 31、reactivity 13、shared 9）；行 86.85%（9052/10423）、分支 80.32%（2392/2978）、函数 75.94%（603/794）。原始报告含各文件未执行行；TS 类型擦除与 tsx 源码映射也会影响行统计，因此不设机械比例门槛。

本次用覆盖报告定位并删除了真实无调用的旧编译辅助。其余未覆盖项包括部分集合/数组操作、只读与错误分支、复杂 TS 类型解析和模板映射组合；这些属于现有能力，不能因本组场景未执行就删除，也不能把本次覆盖率当作全仓覆盖或原生正确性证明。原生与发布包验证随本期退出审计统一记录。
