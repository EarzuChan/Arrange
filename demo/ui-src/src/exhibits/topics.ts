// 主页宫格与次级页页头共用的一份主题清单；interop 为 true 的只在插件宿主里出现
export type TopicKey = 'composition' | 'drawing' | 'layout' | 'focus' | 'lazy' | 'lab' | 'animation' | 'visual' | 'tiers' | 'audio' | 'debug'

export type Topic = Readonly<{
    key: TopicKey
    title: string
    description: string
    icon: string
    interop?: boolean
}>

export const topics: readonly Topic[] = [
    { key: 'composition', title: '组合与状态', description: '组件封装、属性下传与引用转交，状态一变界面跟着变', icon: 'icons/lucide/blocks.svg' },
    { key: 'drawing', title: '绘制与变换', description: '在内容前后作画，旋转镜像后点击仍然命中，层级随时交换', icon: 'icons/lucide/pen-tool.svg' },
    { key: 'layout', title: '弹性布局', description: '流式换行换列，固有尺寸让分隔线跟随内容高度', icon: 'icons/lucide/layout-grid.svg' },
    { key: 'focus', title: '焦点与输入', description: 'Tab 切换焦点，多行编辑、选区与中文组合输入', icon: 'icons/lucide/text-cursor-input.svg' },
    { key: 'lazy', title: '虚拟滚动', description: '千项可变高度只组合可见部分，跳转、重排与删除', icon: 'icons/lucide/list.svg' },
    { key: 'lab', title: '列表与页面', description: '筛选重排的动态列表，切页保留输入，异步加载详情', icon: 'icons/lucide/layers.svg' },
    { key: 'animation', title: '动画', description: '颜色、位移与尺寸过渡，可见性进出与内容交叉淡入', icon: 'icons/lucide/iteration-ccw.svg' },
    { key: 'visual', title: '视觉效果', description: '渐变、投影、背景模糊、像素缓冲与 filmstrip 旋钮', icon: 'icons/lucide/sparkles.svg' },
    { key: 'tiers', title: 'Canvas 三档', description: '同一组电平、波形、频谱，分别用三种数据与绘制路径', icon: 'icons/lucide/activity.svg', interop: true },
    { key: 'audio', title: '音频宿主', description: '参数、自动化、走带与实时观测，预设读写', icon: 'icons/lucide/audio-lines.svg', interop: true },
    { key: 'debug', title: '调试工具', description: '仅在 Debug 版中可用。F5 重新加载、F9 帧诊断叠加层，Debug 下的测试 toast 与错误页', icon: 'icons/lucide/bug.svg' },
]
