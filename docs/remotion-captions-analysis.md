# `@remotion/captions` 研究与复刻计划

> 调研对象：Remotion 的 `@remotion/captions` 包。
> 目的：搞清楚它到底提供了哪些"效果"，对照我们现有的渲染体系，规划如何在本项目复刻。

## 0. 一句话结论

`@remotion/captions` **不是一个动画/特效库**，而是一个**字幕数据工具包**。它做三件事：

1. 定义一个统一的字幕数据类型 `Caption`；
2. 提供 SRT 解析/序列化（`parseSrt` / `serializeSrt`）；
3. 提供 `createTikTokStyleCaptions()`——把"逐词"字幕重组成一页页（page），每页带逐词时间戳。

真正能看到的"TikTok 抖音字幕特效"（当前词高亮/弹跳/放大、整页切换）**不在这个包里**，而是在 Remotion 的模板组件里用 `spring()`/`interpolate()` 手写的。包只提供让逐词动画"好写"的数据骨架。

**对我们意味着什么**：这套体系的核心（逐词时间 + 当前词高亮）我们**已经有了**——`LrcWord{start,end}` + `karaoke` 特效就是它。真正缺的是 **SRT/VTT 导入**和**"整页"概念**这两块数据层能力，而不是渲染能力。

---

## 1. 包的实际导出（API 全貌）

### 1.1 `Caption` 类型（核心数据模型）

```ts
type Caption = {
  text: string;            // 文本（一般是单个词/token，前面常带一个空格做分隔符）
  startMs: number;         // 起始毫秒
  endMs: number;           // 结束毫秒
  timestampMs: number | null; // 词级精确时间戳（Whisper 给的"这个词的时刻"），可空
  confidence: number | null;  // 识别置信度 0..1，可空
};
```

要点：
- Remotion 的字幕**以"词"为最小单位**。一条 `Caption` 通常就是一个词，`text` 前带一个前导空格（`" word"`）当分隔符——这是 `createTikTokStyleCaptions` 切页的依据。
- `timestampMs` 是 Whisper 转写给出的词中心时刻，区别于 `startMs/endMs` 的区间。
- `confidence` 给了"这个词识别得准不准"，可用于做不确定词的弱化显示（我们没有，可忽略）。

### 1.2 `parseSrt({ input }) → { captions: Caption[] }`

把 SRT 字符串解析成 `Caption[]`。SRT 是块状结构：序号 / `00:00:01,000 --> 00:00:03,000` / 文本。注意 SRT 用逗号作毫秒分隔符（`,`），VTT 用点（`.`）。

### 1.3 `serializeSrt({ lines }) → string`

反向：把字幕数据写回 SRT 文本。用于导出/回写。

### 1.4 `createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds }) → { pages: TikTokPage[] }`

**这是这个包的主角。** 把逐词 `Caption[]` 重组成"一页页"：

```ts
type TikTokToken = {
  text: string;   // 词
  fromMs: number; // 该词绝对起始 ms
  toMs: number;   // 该词绝对结束 ms
};

type TikTokPage = {
  text: string;          // 整页拼起来的文本
  startMs: number;       // 整页起始 ms
  durationMs: number;    // 整页时长 ms（v4.0.261+）
  tokens: TikTokToken[]; // 本页逐词，带各自时间
};
```

切页逻辑（源码归纳）：
- 当下一个 token **以空格开头**，且当前已累积的页时长 **超过 `combineTokensWithinMilliseconds`** 时，开一个新页；否则继续往当前页塞词。
- 每页时长 = 下一页起始 − 本页起始（最后一页用自身 token 跨度）。
- `combineTokensWithinMilliseconds` 越大 → 一页塞越多词；越小 → 越接近"一次一个词"。典型值 1000~1200ms 一页几个词。

**它的产物如何被渲染**：模板里 `<Sequence>` 按页排布，页内对每个 token 判断"当前时间是否落在 `fromMs..toMs`"来决定是否高亮——这就是抖音字幕的本质。

### 1.5 不在本包、但配套的转写→Caption 转换器

这些住在**兄弟包**里，输出 `Caption[]`，喂给上面的流程：
- `@remotion/install-whisper-cpp` → `toCaptions()`
- `@remotion/whisper-web` → `toCaptions()`
- `@remotion/openai-whisper` → `openAiWhisperApiToCaptions()`
- `@remotion/elevenlabs` → `elevenLabsTranscriptToCaptions()`

即：**语音 → Whisper 转写 → Caption[] → createTikTokStyleCaptions → 渲染**。我们目前是"已有歌词/字幕文件"路线，转写这一段属于可选的远期能力。

---

## 2. 真正的"视觉效果"（在模板里，不在包里）

官方 skill/模板里 TikTok 字幕的渲染套路：

1. **整页显示**：只渲染"当前页"的词（其余页不画）。
2. **当前词高亮**：`token.fromMs <= tMs && tMs < token.toMs` 为真 → 该词换高亮色（模板用亮绿 `#39E508`），其余白色。
3. **（模板自选）弹跳/放大**：对当前词用 `spring()` 做一次 scale 弹跳、上浮。
4. 时间换算：`tMs = (frame / fps) * 1000`，再加页偏移得绝对时间。
5. 间距：词 `text` 自带前导空格 + CSS `white-space: pre` 保留间距。

**关键判断**：第 2、3 点我们的 `karaoke` 特效已经做到了——当前词染高亮色（`mixHex(textColor, highlightColor, h)`）+ 放大 `scale 1.16` + 上浮 `dy -10` + 进出 90ms ramp 平滑。我们甚至比"硬切颜色"的模板更柔和。

---

## 3. 对照我们的体系：已有 vs 差距

| Remotion 概念 | 我们的对应物 | 状态 |
|---|---|---|
| `Caption{text,startMs,endMs,timestampMs,confidence}` | `LrcWord{text,start,end}` + `LrcChar` | ✅ 已有（更细，到字级；缺 confidence，无所谓） |
| 逐词时间戳 | 增强型 LRC `<mm:ss.xx>` 分段 → `parseSegments` | ✅ 已有 |
| `TikTokPage`（整页） | `LrcLine`（一行=一页） | ✅ 概念等价 |
| 当前词高亮 | `karaoke` 特效（`highlight` 通道 + 放大上浮） | ✅ 已有且更精致 |
| `createTikTokStyleCaptions`（按毫秒阈值自动切页） | 无（我们按 LRC 行切分） | ⚠️ 缺：自动重新分页 |
| `parseSrt` / `serializeSrt` | 只有 `parseLrc`（标准+增强 LRC） | ❌ 缺：SRT 导入/导出 |
| VTT 导入 | 无 | ❌ 缺（samples 里有 .vtt 但没解析） |
| Whisper 转写 → Caption | 无 | ❌ 缺（远期可选） |

**samples/ 里已经放了 `死水 (Vocals).srt` / `.vtt`，但目前代码只认 `.lrc`**（`App.tsx` 导入只调 `parseLrc`，SRT/VTT 文件导进去会因为找不到 `[mm:ss.xx]` 行而报"无有效歌词"）。这是最直接、用户可感知的差距。

---

## 4. 复刻计划

按"性价比"排序，前两步就能把这个包对我们有意义的能力补齐。

### 阶段一：SRT / VTT 导入（最高优先级，纯数据层）✅ 已完成

把 SRT/VTT 解析成我们的 `LrcLine[]`，复用现有渲染——一行字幕 = 一页。

落地实现：
- 新增 `src/core/subtitles.ts`：`parseSrt` / `parseVtt` / `parseCaptions(text, name)`（按扩展名分发）。
  - SRT：按空行分块，解析 `HH:MM:SS,mmm --> HH:MM:SS,mmm`，文本去富文本标签与 HTML 实体。
  - VTT：跳过 `WEBVTT` 头与 `NOTE`/`STYLE` 块（它们不含 `-->`），点号毫秒、时位可省、忽略 cue 设置；行内 `<00:00:01.500>` 词级标记解析成 `segments`（等价增强型 LRC → 逐词高亮）。
- `RawEntry` 增加可选 `end`，`buildLines` 优先采用字幕自带结束时间（比 LRC"下一行起始"更准，能保留 cue 之间的空白间隔）。
- 导入链路：`store.loadLrc` 改调 `parseCaptions`，故 UI 与 CLI 均自动支持；Electron 文件对话框扩展名加入 `srt`/`vtt`。
- 测试：`src/core/subtitles.test.ts`（13 例，含对 `samples/死水 (Vocals).srt|vtt` 真文件的解析校验）；全量 64 例通过，typecheck 干净。

已知限制（既有 word 模型遗留，非本次引入）：行文本由 `words.join('')` 重建，**词间空格被丢弃**——纯中文无影响，但英文整句字幕会粘连（"with English"→"withEnglish"）。若要做英文字幕，需在 word 模型层单独修，属后续工作。

### 阶段二：自动分页 `createTikTokStyleCaptions` 等价物 ✅ 已完成

当字幕是"逐词流"（如 Whisper/词级 VTT）而非"成句行"时，按毫秒阈值重新成页。

落地实现：
- `subtitles.ts` 加 `paginateWords(words, combineWithinMs)` 与 `repaginateLines(lines, combineWithinMs)`：展平所有词→按"页时长不超过阈值"在词边界切页；阈值越大每页越多词（趋整句），越小越逐词。词对象（含逐字时间）原样保留，故所有特效照常工作。
- **页结束时间取下一页起点**（无缝切页，与 Remotion 的 `TikTokPage` 语义一致），末页取末词结束——避免插值词早退导致字幕提前消失。
- store 加 `repaginate(combineWithinMs)`：保留独立文字块、重排歌词行并重分配唯一 id（行级特效/位置因边界改变而重置）。
- UI：`LyricsPanel` 顶部"分页粒度"滑杆（200–4000ms），实时预览"≈ N 页"，「应用分页」按钮一键重组。
- 这步把"一行=一页"升级为"可调粒度分页"，是 Remotion 这个包真正独特的增值点。
- 设计取舍：做成**显式一次性动作**而非实时联动设置——避免拖动滑杆静默冲掉用户的逐行编辑（与"重新导入"同性质）。

### 阶段三：SRT 导出 ✅ 已完成

- `subtitles.ts` 加 `serializeSrt(lines) → string`（跳过空行、序号从 1 起、`HH:MM:SS,mmm` 时间码），与 `parseSrt` 往返一致（已测）。
- Electron 加 `file:saveSrt` 保存对话框 + preload `saveSrt`；顶栏「导出字幕」按钮一键导出。
- 用途：把项目里调好（含重新分页）的时间轴回写成通用字幕。

> 阶段二、三测试见 `src/core/subtitles.test.ts`（共 19 例），全量 70 例通过，typecheck 与 `electron-vite build` 均干净。

### 阶段四（搁置）：Whisper 转写接入

- 没有音频字幕时，跑 whisper.cpp（Electron 主进程起子进程）→ 词级 JSON → 我们的 `LrcWord[]`。
- 工作量大，且偏离"歌词视频"主线。**暂不在本计划内实现——已决定以后用别的方式处理**（待定），此处仅留作背景记录。

---

## 5. 给决策的一句话

我们**不需要引入 `@remotion/captions`**，它的渲染部分我们已经用 Canvas 自研实现且更细腻。值得"复刻"的只是它的**数据工具层**——优先做**阶段一（SRT/VTT 导入）**，立刻让 samples 里现成的 `.srt/.vtt` 能用；阶段二的"可调分页"是锦上添花的差异化功能。

---

## 6. 从 Remotion 借鉴的特效清单（移植进度）

`@remotion/captions` 本身不含动效；以下是从 Remotion 周边（transitions / motion-blur / noise / animation-utils / paths / shapes / layout-utils）梳理出、值得移植进我们 `CharFx` / 特效体系的清单。

### 已落地 ✅
| 想法 | 来源 | 我们的实现 |
|---|---|---|
| 跳动高亮块（抖音 pill） | Remotion-Pro animated captions | `highlightBox` 特效 + render `resolveWordBox`（词包围盒间弹跳） |
| 真·弹簧 `spring()` | `spring()` | `easing.springEase()` + `bounce` 特效 |
| 运动残影 / 拖影 | `@remotion/motion-blur` `Trail` | `EffectPreset.trail` + render `drawCharTrail` + `streak` 特效 |
| 噪声飘摆 + 错切/倾斜 | `@remotion/noise` + `animation-utils`(skew) | `easing.valueNoise()` + `CharFx.skewX/skewY` + `wobble` 特效 |
| 遮罩式场景切换 wipe / iris / clockWipe | `@remotion/transitions` | `EffectPreset.reveal` + render `drawLineReveal`（动画裁剪揭示）+ `wipe`/`iris`/`clockWipe` 特效 |

> 新增基元：`springEase`、`valueNoise`（easing.ts）；`CharFx.skewX/skewY`、`EffectPreset.trail`、`EffectPreset.reveal`（types.ts）；render 抽出 `charFxAt` 复用于主体与残影，新增 `drawLineReveal` 做遮罩揭示（在 enterDuration 内推进裁剪区域，完成后回退常规绘制）。新增特效 `bounce`/`streak`/`wobble`/`wipe`/`iris`/`clockWipe` 已注册进 `EFFECTS`，可在 GUI 选择、也可在 `job.json` 用 `effectId`/`lineEffects` 脚本化。测试：`easing.test.ts`、`render.test.ts`；全量 89 例通过。

### 待办（需要不同的机制，不套用现有 `CharFx`/`LineFx`）
- **cube 立方体翻转**（`@remotion/transitions`）：需要真·透视/3D 投影，Canvas 2D 只能做拙劣近似——**已主动跳过**（要做得用 WebGL，或退而用现有 `flip` 停靠式翻转近似）。
- **描边逐显（draw-on 下划线/手写）**：`@remotion/paths` `evolvePath` —— 需要 SVG 路径长度测量 + `setLineDash` 动画。
- **装饰形状**（`@remotion/shapes`）：圆/星/三角等强调元素，需要在文字层之外新增"图形装饰"图元。
- **自动适配字号** `fitText`（`@remotion/layout-utils`）：把文字自动缩放填满给定框；我们 `layout.ts` 目前是手写排版，可作为增强项。

这些每一项都是独立的、体量更大的改动，建议各自单独立项，而非塞进现有逐字特效循环。
