# Arrange Runtime

应用通过 `@arrange/framework` 使用本包，模板与手写 render 共享原生宿主。

```ts
import {Column, Text, arrangeValue, createApp, defineComponent, h, m, ref} from '@arrange/framework'

const Page = defineComponent({
    setup() {
        const count = ref(0)

        return () => h(Column, {modifier: m.padding(12)}, [
            h(Text, {
                text: arrangeValue(() => `次数：${count.value}`),
                modifier: m.clickable(() => { count.value++ }),
            }),
        ])
    },
})

createApp(Page).mount()
```

公开名称和签名见 [基础 API 形态](../../docs/arch/21-基础API形态.md)，执行域、组件所有权、KeepAlive/Suspense 见 [Arrange Vue 宿主目标](../../docs/arch/27-ArrangeVue宿主目标.md)，nextTick/生命周期与发布边界见 [调度线程与帧阶段](../../docs/arch/26-调度线程与帧阶段.md)，动画见 [动画与 Transition](../../docs/arch/28-动画与Transition.md)。

[主 Demo](../../demo/ui-src/src/App.vue) 提供完整示例；[测试策略](../../docs/arch/22-测试策略.md) 规定自动化与人工验收的边界。
