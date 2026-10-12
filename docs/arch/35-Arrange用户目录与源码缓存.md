# Arrange 用户目录与源码缓存

本文定义 Arrange 在设备、用户层面的目录和共享源码生命周期，CLI 与未来框架运行时遵守同一边界。工程配置、命令与构建职责见 [CLI 与工程模式](31-ArrangeCLI与工程模式.md)，原生包消费见 [Native 包消费契约](30-Native包消费与FetchContent契约.md)。

## 两个作用域

Windows 与 macOS 均以当前用户主目录下的 `~/.arrange` 为默认用户级根。用户可用绝对路径环境变量 `ARRANGE_HOME` 显式覆盖；相对路径拒绝使用，不自动回退到其它目录。路径解析与只读检查不创建目录，实际写入时才创建。

用户级目录属于 Arrange 在这台设备、这个用户下的工作空间，不属于某个工程，不应整体视为可删除缓存。工程内 `<project>/.arrange` 保留工程日志、构建凭据等本机工作状态；`arrange.local.yaml` 表达该工程的本机工具与路径选择。工程清理不能顺带删除用户级内容。

```text
~/.arrange/
  builds/                  各工程独立的 native 构建树，CLI 管理
  sources/                 共享固定版本源码，CLI 管理
    requests/              来源与 ref 到确切 commit 的本机索引
    entries/               发布完成的源码与身份记录
    locks/                 跨进程获取、发布锁
    tmp/                   尚未发布的获取内容
  tmp/                     用户级其它临时工作目录，按需使用
  runtime/                 框架运行时用户数据的目录边界，当前未启用写入
```

CLI 不清理框架运行时持久数据，运行时不修改 CLI 发布的源码快照。当前不引入用户配置文件、后台缓存服务或自动空间回收。

## 构建目录

默认 native 构建树位于 `builds/<工程根路径 SHA-256 前 8 位>/<平台架构配置>`。Windows 的工程路径身份忽略大小写，配置目录为 `xd/xr/ad/ar`；macOS 保留路径大小写，配置目录为 `mac-xd/mac-xr/mac-ad/mac-ar`。其中 `x/a` 表示 x64/arm64，`d/r` 表示 debug/release。

同一工程的所有权记录 `owner.json` 保存项目根路径；写入经锁保护并原子发布，身份不匹配或记录损坏时明确拒绝。不同工程、架构、配置与平台不共用生成文件和编译结果。`native.buildRoot` 可覆盖构建根，相对值相对于工程根解析。

CLI 只解析当前用户级目录契约，不探测其它默认目录，不提供旧布局迁移或回退。工程移动到新位置后按新根重新配置。

Windows 长路径限制与 configure 预检见 [CLI 工具链](31-ArrangeCLI与工程模式.md#版本与工具链)。主目录过长时用户明确设置更短的 `ARRANGE_HOME` 或 `native.buildRoot`；两端不采用需要额外权限的目录别名或符号链接缩短路径。

## 共享源码

缓存源码包含 Arrange、JUCE 和 QuickJS-NG；平台、编译器、架构与 debug/release 不进入源码身份。所有编译结果仍在独立构建树中。CLI 准备源码后传入 CMake 标准 `FETCHCONTENT_SOURCE_DIR_ARRANGE/JUCE/QUICKJS_NG`，不将自动生成的缓存路径写进工程 YAML，不改变 CMake 的公开 target 或消费方式。

来源与 ref、可选固定 commit 构成请求身份。下载完成后，以原始仓库来源和实际 commit 的哈希标识内容，同一来源、同一 commit 可由不同 ref 共用。目录采用短哈希，记录保留完整内容身份以检查碰撞。索引不保存仓库凭据，Git 输出在进入任务日志前抹去 URL 用户信息。

默认依赖版本由每个 Arrange 版本的 `cmake/NativeDependencies.json` 声明，CLI 不维护另一份版本表。获取时校验 tag 对应 commit。依赖清单必须存在且包含固定 commit；缺失或无效时明确失败，不解析 CMake 声明作为替代来源。用户显式覆盖仓库或版本时按覆盖值获取，不套用默认 commit。

同一请求首次解析成功后记录实际 commit，日常命中使用这个快照，不联网追踪 tag 移动。已经知道固定 commit 时直接查内容缓存，不因 ref 变化重复下载。缓存命中检查发布记录、源码入口和 detached HEAD，准备时另以本地 Git diff 检查 tracked 源码是否被改动；不会静默覆盖受损缓存。开发源码修改应使用显式本地目录覆盖。

CLI 仅缓存可确认来源的工程：Arrange 仓库与版本均由 CLI 托管时获取 Arrange；已显式提供本地 Arrange 时从该目录读取依赖清单。自定义未托管 CMake 的来源不由 CLI 猜测。`JUCE_DIR`、`ARRANGE_QUICKJS_NG_SOURCE_DIR`、各 `FETCHCONTENT_SOURCE_DIR_*` 显式覆盖优先，不接管、移动或删除用户目录。

## 获取、并发与恢复

缓存命中不 fetch。缺失条目取得跨进程请求锁后再次检查，然后在同一缓存文件系统的临时目录内获取 Git commit 和递归子模块。验证入口与版本后，在内容锁保护下原子发布完整条目，再原子发布请求索引。发布后的快照不切换 commit；新版本建立新条目。

跨进程锁使用 `proper-lockfile` 的目录锁与心跳机制；等待可以取消，等待超时明确报错，失去锁的任务停止获取并禁止发布。不同工程或 debug/release 争用同一请求时只由一个持有者获取。进程取消不发布半成品；异常退出留下的失效锁由后续请求恢复，持有请求锁后清理该请求遗留的临时目录。

完整缓存存在时源码预检不要求远端可达；需要新源码时仍报告真实网络、版本或 Git 错误。此能力不等同于整个工程离线运行，npm 安装与 Framework 兼容性检查各自遵守既有契约。

当前不自动淘汰条目，也不复用旧工程 `_deps` 作为缓存来源。已有 CMake 构建树可能引用发布条目的路径，用户手动删除缓存后应重新运行 native SETUP。缓存目录下的符号链接或越界路径在检查、写入与递归清理前拒绝，不允许清理逃逸至其它目录。
