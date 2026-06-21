# 特效插件平台设计

> 目标：让第三方（含其 AI agent 读完文档后）能轻松贡献**文字特效**与**视频特效**，
> app 直接导入这些插件即可使用。

## 原型状态（已实现的最小纵切）

**文字特效**的「契约 + 适配器 + 运行时注册表 + 本地导入」已落地，可端到端跑通：

- `src/core/effects/sdk.ts`：公开契约（`TextEffectDef`/`TextFxArgs`/`PartialCharFx`/`PluginHelpers`）、适配器 `textEffectToPreset`、输出校验 `sanitizeCharFx`、清单校验 `validateManifest`。
- `src/core/effects/index.ts`：插件注册表（`registerTextEffect`/`getEffect` 优先查插件）。
- `src/plugins.ts`：经 blob URL 动态 import 装载插件源码（软装载）。
- UI：顶栏「导入插件」→ 选 `.mjs/.js` → **先校验**（不通过则拒绝导入）→ 注册 → 出现在特效选择器（带「插件」标记）；预览与导出通用。
- 示例：`examples/plugin-wave.mjs`（波浪 / 弹跳落入）。测试：`src/core/effects/sdk.test.ts`。

**校验器**（第 8 节）也已落地：
- `src/core/effects/validator.ts`：自包含引擎 `validatePlugin(manifest, source?)`——确定性（同参两跑比对）、范围/有限性、性能、源码禁用项扫描（先剥离注释避免误判）、不崩；返回结构化报告。app 导入时调用它兜在沙箱之前。
- CLI：`node scripts/validate-plugin.ts <plugin.mjs>`（或 `npm run validate-plugin -- <file>`），通过/失败对应退出码 0/1，供第三方/agent 自检。
- 测试：`src/core/effects/validator.test.ts`（含与 easing 工具对齐的守护）。

**SDK 已公开（第 9 节）**：`plugin-sdk/` 目录——
- `effect-plugin.d.ts`：独立、无依赖的公开契约（`PluginManifest`/`TextEffectDef`/`TextFxArgs`/`PartialCharFx`/`PluginHelpers`），由 `src/core/effects/sdk-parity.test.ts` 编译期守护与 `sdk.ts` 不漂移。契约含**声明式遮罩能力** `reveal`/`trail`/`wordBox`（见第 5 节）。
- `manifest.schema.json`：清单静态字段 JSON Schema。
- `template.mjs`：带 JSDoc 类型引用的起步模板（零构建即得补全）。
- `README.md`：贡献者指南（坐标系/单位/时序/确定性/校验/导入/安全模型）。

**硬沙箱已落地（导入期闸门，第 6 节）**：`src/pluginSandbox.ts`——
- `probePluginInWorker(source)`：把不受信源码送进**模块 Worker**，启动时遮蔽 `Date`/`Math.random`/`performance`/`fetch`/`XMLHttpRequest`/`WebSocket`/`importScripts` 等，再 `import` 插件，对样本网格**一次性批量两跑**（batched evaluation），并由宿主侧硬超时（默认 2s）抓死循环（超时即 `terminate`）。
- `analyzeProbe`（纯函数，单测覆盖）：两跑比对判非确定性、范围/有限性检查。
- `loadPluginSource` 先过 Worker 闸门再在主世界 import 使用；Worker 不可用（node/vitest/headless）抛 `SandboxUnavailableError` → 降级同步校验（determinism 由两跑保证，与渲染世界无关，降级仍安全）。
- **架构权衡（已知局限）**：渲染热路径是**同步**逐帧逐字，Worker 是异步的，无法为逐帧渲染做隔离——因此 Worker 只作**导入期闸门**，逐帧执行仍在主世界（带 try/catch + 钳制）。真正的同步逐帧隔离需要 **QuickJS-WASM**（同步 in-process isolate），列为下一步。当前闸门已能抓住：死循环、访问被禁全局、非确定性、越界/NaN。

**未做（下一步）**：QuickJS-WASM 逐帧隔离、视频转场插件（把 `clipTransition` 改为注册表驱动）、缩略图渲染（需 headless 画布）、工程/Job 的插件依赖记录、市场/签名。下文为完整设计。

**示例插件**：`examples/plugin-wave.mjs`（波浪/弹跳落入）、`examples/plugin-neon.mjs`（霓虹闪入/百叶窗，演示 glow/highlight/skew/rand）、`examples/plugin-masks.mjs`（圆形展开/残影滑入/跳动高亮块，演示声明式 reveal/trail/wordBox）。

## 0. 为什么我们的架构天然适合做插件

我们的特效本质是**纯函数**——给定时间/序号等参数，返回一组变换数值，无 I/O、无副作用、逐帧确定性（预览与导出必须画出同一帧）。这正是"可安全托管第三方代码"的理想形态：

- 文字特效：`apply(args) → CharFx`（见 `src/core/effects/types.ts`）。
- 视频转场：`clipTransition` 内部的 `fxIn(p)/fxOut(p) → VideoClipFx`（见 `src/core/media.ts`）。

插件要做的，就是提供这些纯函数。平台要做的，是**稳定的契约 + 安全沙箱 + 导入/分发 + 可被 agent 自助校验的文档**。

## 1. 设计原则

1. **确定性优先**：插件只能依赖传入参数与平台提供的"种子随机"。禁用 `Date.now`/`Math.random`/`performance.now`，否则预览≠导出。
2. **纯净 & 同步**：无网络、无存储、无 DOM、无 async；一次调用必须很快返回（逐帧逐字会被调成千上万次）。
3. **契约与内部解耦**：插件面向一份**版本化的公开 SDK 契约**，而非内部 `EffectPreset`；内部重构不破坏插件。
4. **宿主兜底**：插件返回**部分**字段，宿主合并到恒等值并钳制范围；NaN/越界一律回退，坏插件不能搞崩渲染。
5. **Agent 友好**：契约有机读 schema、有模板、有可自助运行的校验器。

## 2. 插件包格式

一个插件 = 一个 ES module，默认导出一份清单：

```js
export default {
  api: 1,                      // SDK 契约版本
  name: "Wave Pack",
  version: "1.0.0",
  author: "alice",
  homepage: "https://...",     // 可选
  textEffects: [ /* TextEffectDef[] */ ],
  videoTransitions: [ /* VideoTransitionDef[] */ ]
}
```

打包形态分阶段：本地单文件 `.mjs` → 后续 npm 包 / 注册表条目（带签名）。

## 3. 文字特效契约（TextEffectDef）

```ts
interface TextEffectDef {
  id: string            // 全局唯一，建议带命名空间，如 "alice.wave"
  name: string          // 显示名（可后续支持 i18n）
  unit: 'char' | 'word' // 动画单元
  enterDurationMs: number
  appearAtLineStart?: boolean   // 整行一起出现（卡拉OK类）
  // 纯函数：返回"相对恒等的增量"，未给的字段用默认
  apply(args: TextFxArgs, m: Helpers): PartialCharFx
}

interface TextFxArgs {       // 与内部 FxArgs 对齐、但属公开契约
  unitIndex: number          // 词/字在行内序号
  unitCount: number
  charIndexInUnit: number
  enterT: number             // 进场进度 0..1（出场后恒 1）
  timeInLine: number         // 距行首 ms
  lineDuration: number
  unitStart: number          // 本单元相对行首起止 ms（卡拉OK判断当前词用）
  unitEnd: number
  intensity: number          // 用户强度，1 为默认
  rand(key: number): number  // 确定性随机 [0,1)，按行播种、逐帧稳定
}

// 返回：只写你要改的（宿主合并到 IDENTITY 并钳制）
type PartialCharFx = Partial<{
  dx: number; dy: number; scale: number; rotate: number  // rad
  alpha: number; blur: number; glow: number; highlight: number  // 0..1
  skewX: number; skewY: number
}>

interface Helpers {          // 平台提供的纯工具，免去访问全局
  clamp01(t: number): number
  lerp(a: number, b: number, t: number): number
  easeOutCubic(t: number): number
  easeOutBack(t: number): number
  spring(t: number): number
  noise(seed: number, x: number): number  // 平滑值噪声
}
```

示例：

```js
{
  id: "alice.wave", name: "波浪", unit: "char", enterDurationMs: 300,
  apply({ enterT, charIndexInUnit, timeInLine, intensity }, m) {
    return {
      dy: Math.sin(timeInLine / 200 + charIndexInUnit) * 8 * intensity,
      alpha: m.clamp01(enterT)
    }
  }
}
```

## 4. 视频转场契约（VideoTransitionDef）

```ts
interface VideoTransitionDef {
  id: string
  name: string
  in(p: number, m: Helpers): PartialVideoFx   // 进场，p: 0→1
  out(p: number, m: Helpers): PartialVideoFx   // 退场，p: 1→0（1 仍完整）
}

type PartialVideoFx = Partial<{
  alpha: number
  dxFrac: number; dyFrac: number      // 画布宽/高的比例平移
  scale: number                        // 乘到线段自身缩放之上
  wipe: { dir: 'L'|'R'|'U'|'D'; reveal: number }  // 擦除遮罩
}>
```

视频间转场仍沿用"重叠两段 + 后段 `in`"的既有模型（见 MANUAL），插件只需定义 in/out 姿态。

## 5. 高级能力（声明式暴露）

内部几类更复杂的能力不交给任意代码，而是以 **TextEffectDef 上的声明式字段**（数据而非函数）开放，宿主渲染、规范化、钳制——无新增可执行面，过隔离闸门不变：

- ✅ **已开放**：`reveal`（`'wipe'|'iris'|'clockWipe'` 遮罩揭示）、`trail`（`{count, stepMs, decay?}` 运动残影，宿主钳 count≤12 / stepMs∈[1,200]）、`wordBox`（跳动高亮块布尔）。见 `sdk.ts` 的 `normReveal`/`normTrail` 与适配器透传；`validateManifest` 丢弃非法 `reveal`。示例 `examples/plugin-masks.mjs`。
- ⏳ `lineTransition`（停靠式整行转场）——结构复杂、需多行包围盒，仍留作平台内置或后期高级 SDK。

覆盖面：逐字 `apply` + 声明式 reveal/trail/wordBox，已能表达绝大多数文字特效（含遮罩揭示）；视频 in/out 见下。

## 6. 安全与沙箱

第三方代码每帧跑在渲染热路径上，必须托管而非裸跑：

- **纯净约束**：禁 async/网络/DOM/存储；`window`/`document`/`fetch`/`require`/`import`/`globalThis` 在执行作用域内被遮蔽，只暴露 `Math` 与平台 `m`。
- **确定性约束**：`Date`/`Math.random`/`performance` 被替换为禁用桩；随机只能用 `args.rand`。
- **输出校验**：每个返回字段做有限性检查与范围钳制，NaN/Infinity/越界→回退恒等。
- **时间预算**：单次调用超时则停用该插件并提示（防死循环/超重计算）。
- **隔离强度分级**：
  - *软沙箱*（初版）：`new Function` + 遮蔽全局 + 输出校验，够用于半受信场景。
  - *硬沙箱*（受信任市场之外）：QuickJS-WASM / Worker 内执行；逐帧跨边界有成本，可用"批量求值（一行所有字一次性算）"或预编译到内部表示来摊薄。

## 7. App 内导入与分发

- **阶段一·本地导入**：菜单「导入插件」选 `.mjs` → 校验清单 → 注册进运行时特效表 → 出现在特效选择器里（带插件名标签）。
- **工程引用**：工程文件记录所用插件 `id@version`；打开工程若缺插件，提示安装；CLI 的 `job.json` 同理可声明依赖。
- **阶段二·注册表/市场**：托管索引，按 id 安装；包签名 + 版本语义化；评分/举报。

## 8. 确定性与校验工具（让 agent 自助过关）

平台随附一个**校验器**（可复用现有 headless 渲染设施）：`validate plugin.mjs` 会——

1. 加载并校验清单/类型；
2. 在一批采样帧上跑每个特效，**跑两遍比对**确保确定性；
3. 检查输出有限性与范围、是否触碰禁用全局；
4. 量执行耗时是否超预算；
5. 产出一张缩略图供肉眼确认。

agent 写完插件后跑校验器即可自检——这是"agent 读文档→产出可用插件"的闭环关键。

## 9. 面向 agent 的文档产物

- **机读契约**：把第 3–4 节类型导出为 `.d.ts` + JSON Schema，公开发布。
- **模板仓库** + 最小示例（一个文字特效、一个视频转场）。
- **语义参考**：坐标系/单位（dx/dy 画布像素、rotate 弧度、frac 比例…）、`enterT`/`timeInLine` 时序、`rand` 播种规则，配图。
- **校验器**作为契约的一部分发布。

## 10. 与现有代码的衔接（迁移）

- 内部 `EffectPreset`/`clipTransition` 保留；新增一层**适配器**把 `TextEffectDef`/`VideoTransitionDef` 包成内部结构（apply 包一层做合并+钳制+沙箱）。
- 现有内置特效（pop/karaoke/highlightBox/wipe…）即"第一方参考实现"，可据此反推、校准公开契约。
- 特效表从静态 `EFFECTS` 数组升级为「内置 + 已注册插件」的运行时注册表；`getEffect(id)` 查注册表。

## 11. 路线图

1. 定稿公开 SDK 契约（文字 apply + 视频 in/out、部分返回、`m` 工具）+ 内部适配器。
2. 运行时注册表 + 本地导入 + 选择器集成 + 工程/Job 的插件引用。
3. 校验器（确定性/范围/性能/禁用全局）——agent 自检闭环。
4. 沙箱加固（Worker/QuickJS）面向不受信插件。
5. 注册表/市场 + 签名 + 版本兼容策略。

## 12. 待决问题

- 信任与签名模型（谁能上架、如何撤销）。
- 插件能否携带资源（字体/查找表/着色器）？
- 是否开放 **WebGL/着色器**特效（超出 Canvas2D 的数值变换，能力更强但沙箱更难）？
- 特效名/描述的多语言。
- 商业化（付费插件、分成）。
