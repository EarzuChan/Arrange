# Arrange Runtime

应用通过 @arrange/framework 使用 SFA 模板。参数、内容与布局能力均由正式 Arrangable 定义声明。

```sfa
<template>
    <Text :text="String(count)" :modifier="M.clickable(() => count++)" />
</template>

<script>
import { M, ref } from '@arrange/framework'

const count = ref(0)
</script>
```

公开签名见 [基础 API](../../docs/arch/21-基础API形态.md)，模板规则见 [宿主目标](../../docs/arch/27-ArrangeVue宿主目标.md)，执行与发布边界见 [调度](../../docs/arch/26-调度线程与帧阶段.md)，完整示例见 [Demo](../../demo/ui-src/src/App.sfa)。
