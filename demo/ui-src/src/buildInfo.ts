// 由 vite.config.ts 在构建时注入；未经该配置构建（如框架测试夹具）时回落为 dev
declare const __ARRANGE_DEMO_BUILD__: { version: string; framework: string } | undefined

export const buildInfo: { readonly version: string; readonly framework: string } = typeof __ARRANGE_DEMO_BUILD__ === 'undefined' ? { version: 'dev', framework: 'dev' } : __ARRANGE_DEMO_BUILD__

// TIPS：这是注入给 App，让其获知框架和自身 App 版本