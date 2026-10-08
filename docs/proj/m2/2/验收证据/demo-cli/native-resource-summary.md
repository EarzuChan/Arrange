# Native Live 资源回归

最终源码支持 Live 当前 origin 的相对路径、包根路径、同 origin HTTP(S) URL 与 Vite 查询参数，并支持 Vite 发出的 PNG/SVG data URL。Dist 的 leading slash 地址按包根 URL 单次解码；相对地址保持字面文件名，包括百分号和问号。Live HTTP 执行时限上限 5 秒、响应预算上限 16 MiB，可显式选择更短时限或更小预算，读取不落临时文件。

退出故障已实际复现并修复：每个 worker job 使用 macOS autorelease scope；私有共享线程池在 JUCE GUI shutdown 删除 MessageManager 前销毁；SVG 锁响应当前 ThreadPoolJob 取消。完成请求后的失败退出、尚未完成 SVG 请求时退出、正在等待 5 秒 HTTP deadline 时退出都正常返回预期代码 1，未出现 assertion、泄漏或 segfault。退出测试的 HTTP fixture 持续到 GUI 关闭后再正常析构，不以先 join 服务假装 worker 已结束。

最终 Debug/arm64/Ninja CTest 6/6 通过：arrange_core_smoke、arrange_m24_contract、arrange_painter_resources、arrange_painter_resources_failed_exit、arrange_painter_resources_pending_exit、arrange_painter_resources_pending_http_exit。clang-format 22 dry-run 与 git diff --check 通过。

构建：

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer /usr/local/bin/cmake --build /tmp/arrange-demo-cli-icPpq0/native-resource-tests --target arrange_painter_resources arrange_m24_contract arrange_core_smoke -j4
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer /usr/local/bin/ctest --test-dir /tmp/arrange-demo-cli-icPpq0/native-resource-tests --output-on-failure -R 'arrange_(painter_resources|m24_contract|core_smoke)'
```

最终日志：native-resource-build.log、native-resource-ctest.log、native-resource-pending-exit.log，完整 CTest 输出在 native-resource-tests/Testing/Temporary/LastTest.log。中间故障证据保留在 native-resource-ctest-before-message-loop.log、native-resource-ctest-message-loop.log、native-resource-lldb-backtrace.log 与 native-resource-pending-exit-before.log。

Windows 实现沿用 JUCE WebInputStream 与 C++20，不在此 Mac 验证实际 Windows 执行。
