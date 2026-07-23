# 设计文档 — AliceCut

把 `.lrc` 歌词 + 音频转换成短视频平台风格的「动态歌词视频」（Kinetic Typography）。
本文档描述整体架构、核心模型、自动化（pipeline）接口与关键技术决策。
使用方法见 [MANUAL.md](MANUAL.md)。

## 1. 目标与形态

- **输入**：`.lrc` 歌词（标准 / 增强型逐字 / GBK / offset / 一行多时间戳）+ 可选音频（mp3/wav/m4a/flac…）
- **输出**：MP4/MOV 容器，H.264 / H.265(HEVC) / ProRes 编码可选（30/60fps，可含音轨），
  分辨率预设 9:16 / 16:9 / 1:1，面向手机端观看；默认 H.264 MP4 兼容性最好，
  ProRes 强制 .mov 容器，面向 Mac 剪辑软件
- **两种使用形态**：
  1. 桌面 GUI（Electron）：交互式编辑、预览、导出
  2. 无头 CLI（`--export job.json`）：同一二进制，放进 pipeline 自动化产出（见 §7）

## 2. 架构总览

```
┌─ electron/（主进程，Node）────────────────────────────┐
│ main.ts      窗口、文件对话框、GUI/headless 启动分流     │
│ headless.ts  --export 参数解析、job 准备、进度/退出码    │
│ exporter.ts  spawn ffmpeg，stdin 收帧（背压控制）        │
│ lrcFile.ts   LRC 读取（GBK 自动回退）                   │
└──────────────────── IPC（contextBridge）───────────────┘
┌─ src/（渲染进程，Chromium）────────────────────────────┐
│ core/        纯函数核心：解析/排版/特效/渲染（可单测）    │
│ store/       zustand：歌词、样式、选区、播放状态          │
│ components/  React UI：预览/时间轴/歌词列表/样式/导出     │
│ exportRunner.ts  共享导出循环（GUI 弹窗和 headless 共用） │
│ headlessExport.ts  无头模式执行器                        │
└────────────────────────────────────────────────────────┘
```

**核心原则**：

- **纯函数核心**：`src/core/` 不依赖 DOM/Electron/React（canvas context 由外部注入），全部可单测。
- **逐帧确定性**：`renderFrame(ctx, lines, meta, style, tMs)` 相同输入永远画出同一帧。所有随机（错落构图等）走按行播种的 `seededRand`。
- **预览 = 导出 = CLI**：三条路径调同一个 `renderFrame` 和同一个 `runExport` 循环，画面构图一致。
  两个明确的速度/确定性取舍见 §6：背景视频默认用 `videoFrameMode:'fast'` 正向追帧；H.264
  硬件导出默认用 WebCodecs。需要可重复的软件路径时关闭硬件加速；背景视频还需选择
  `videoFrameMode:'exact'`。

### 2.1 模块清单

| 模块 | 职责 |
|---|---|
| `src/core/lrc.ts` | LRC 文本 → `ParsedLrc`（标准/增强/多时间戳/元数据/offset） |
| `src/core/timing.ts` | 逐字时间插值、行结束推算、`shiftLine`/`retimeLine` 线段时间编辑 |
| `src/core/layout.ts` | 字符排版：换行、居中/错落构图，输出 `PlacedChar[]`（确定性随机） |
| `src/core/effects/` | 特效预设（见 §4），`index.ts` 注册表 |
| `src/core/render.ts` | 逐帧绘制入口 + 布局缓存 + 行块测量（`getLineBlockRect` 供选中框）+ 按字幕组分流绘制 |
| `src/core/easing.ts` | 缓动函数与 `seededRand` |
| `src/core/media.ts` | 媒体线段（背景视频/音轨）纯数据模型：循环展开、源时间取模、时长计算 |
| `src/store/project.ts` | zustand 单 store：歌词/字幕组/媒体线段/样式/选区/播放标志 + 全部编辑动作 |
| `src/playback.ts` | 播放控制单例：`performance.now` 为唯一时钟源，媒体元素每帧向时钟对齐 |
| `src/mediaPool.ts` | 媒体元素池：每个线段一个 `<video>/<audio>`（media:// 流式读取），预览同步 + 导出精确 seek |
| `src/exportRunner.ts` | 共享导出循环（GUI 与 headless 共用） |
| `src/projectCommand.ts` | job/命令 → store 落地的纯函数层，headless 与命令控制台共用（见 §7 命令控制台） |
| `src/headlessExport.ts` | 无头模式执行器（复用 store 加载逻辑，调 `projectCommand.ts`） |
| `src/consoleCommand.ts` | 命令控制台执行器：解析命令 JSON、经 IPC 解析文件路径，调 `projectCommand.ts` |
| `src/fonts.ts` | 内置字体加载（FontFace）与用户字体导入 |
| `electron/main.ts` | 启动分流（GUI / `--export`）、文件对话框 IPC |
| `electron/exporter.ts` | ffmpeg 进程管理、帧写入背压 |
| `electron/headless.ts` | job 解析与准备、进度→stdout、退出码 |

### 2.2 IPC 接口（preload `window.desktop`）

| 通道 | 方向 | 用途 |
|---|---|---|
| `file:openLrc` / `openFont` / `openProject` | invoke | 文件对话框 + 读内容（渲染进程无 Node 权限，统一主进程读） |
| `file:openAudio` / `openVideo` | invoke | 媒体文件对话框（多选），只返回路径——内容经 `media://` 协议流式读取 |
| `file:saveProject` / `saveVideoPath` | invoke | 保存对话框 |
| `file:exists` | invoke | 工程载入时检查媒体文件是否还在原路径 |
| `export:start` / `frame` / `end` / `cancel` | invoke | 导出会话；`frame` 的 await 即背压 |
| `headless:job` | invoke | 启动时取无头任务（GUI 模式返回 null，渲染进程据此分流） |
| `headless:progress` / `log` | send | 进度与日志 → 主进程 stdout |
| `headless:done` | invoke | 上报结果，主进程按 0/1 退出 |
| `file:readText` | invoke | 命令控制台专用：按**绝对路径**读文本文件（歌词/字幕），复用 `readLrcText`（GBK 回退）；路径非绝对或读取失败一律返回 `null` |
| `job:normalizeClips` | invoke | 命令控制台专用：把 `audio`/`video` 字段归一成 `HeadlessClip[]`，复用 `electron/headless.ts` 的 `normalizeClips`（转场/淡入淡出/裁剪解析与 job.json 完全一致），路径校验换成"必须已是绝对路径"（控制台没有 job 目录可相对解析） |

两个新增通道刻意复用主进程已有的解析函数，而不是在渲染进程里重新实现一遍——命令控制台
与 headless CLI 的唯一差异应该只是"文件路径怎么变成数据"，不是"数据怎么应用到 store"（后者
见 §7.1）。信任模型上不算新增暴露面：`media://` 协议本身早已对任意路径做无校验的
`stat`/`createReadStream`，单机单用户桌面应用，两个新通道只是把这份既有信任延伸到文本读取。

### 2.3 状态管理

单一 zustand store（`useProject`）。要点：

- 歌词行数组始终**按 start 排序**（渲染器找当前行、时间轴渲染都依赖）
- 时间轴拖拽采用「**起始快照 + 绝对增量**」模式：mousedown 时深拷贝选中行，
  每次 mousemove 用 `moveLinesFrom(originals, delta)` 从快照重算——避免增量累积误差，
  天然支持拖回原位
- 选区（`selectedIds`）是纯 UI 状态，不进工程文件
- 高频字段（`currentTime` 每帧更新）由独立小组件订阅（播放条、时间轴播放头），
  避免整树重渲染；预览画布完全不走 React 渲染，rAF 里直接读 `getState()`

## 3. 数据模型（src/core/types.ts）

```
ParsedLrc { meta: LrcMeta, lines: LrcLine[] }
LrcLine   { id, start, end, text, words: LrcWord[],
            effectId: string|null,   ← 行级特效（null = 跟随全局）
            dx, dy,                  ← 行级画面位置偏移（画布像素）
            trackId?: number }       ← 所属字幕组；缺省 = 主字幕组（0）
LrcWord   { text, start, end, chars: LrcChar[] }
LrcChar   { text, start, end }
CaptionTrack { id, name, lrcName, meta, offsetY, visible }  ← 额外字幕组（id≥1）的元信息
ImageAsset   { id, path, name }                              ← 图片库里的一张图片（当前只用作背景图候选）
```

- 标准 LRC：行时长内按字符权重插值出逐字时间（标点权重 0.2，进场窗口 ≤ 行时长 65% 且 ≤ 4s）。
- 增强型 LRC（`<mm:ss.xx>`）：直接采用精确逐字时间，段内字符均分。
- 行也是时间轴上的**线段**：`shiftLine`（整体平移，保持逐字相对时间）、`retimeLine`（重设起止，逐字按比例重映射）。
- 媒体线段（`src/core/media.ts`）：

```
MediaClip { id, kind: 'video'|'audio', path, name,
            start,                 ← 时间轴起点 ms
            sourceDuration,        ← 素材总时长 ms
            sourceIn, sourceOut,   ← 源修剪区间 ms（切割产生）
            speed,                 ← 0.25–4 倍速
            loop: n | 'infinite',  ← 重复次数 / 循环到项目结束
            layer,                 ← 视频层序（高层盖低层，画中画）
            tx, ty, scale }        ← 视频画面平移/缩放（cover 适配为基准）
```

  核心是 `clipSourceTime(clip, tMs, projectEndMs)`：tMs 在线段激活窗口内时返回
  `sourceIn + ((tMs - start) % segLen) × speed`（segLen = 修剪区间 ÷ speed），
  预览同步、导出取帧、ffmpeg 参数都从它派生。
  切割（`splitClipAt`）：循环线段先按圈展开成 loop=1 的段，再在切点把源区间一分为二。
  项目时长 = max(歌词结尾 + 2s, 有限线段最晚结束)；无限循环线段不参与时长计算。
- 独立文字块 = `LrcLine` 加 `kind: 'text'`：复用行的全部编辑（拖动/特效/位置偏移/选区），
  渲染时不参与歌词流（当前行扫描与停靠堆叠历史），在自己的起止区间内独立进退场；
  停靠式特效对文字块演绎为整块 enterFrom → pose(0) 进场。与字幕组无关（trackId 不影响文字块）。
- 字幕组（多语言字幕）= 多份并行的歌词流，各自独立走「当前行 → 停靠转场/逐行进退场」的完整逻辑
  （`src/core/render.ts` 的 `drawLyricFlow`），只是纵向按 `offsetY` 错开，互不重叠。
  主字幕组（id 0）复用既有的顶层 `meta`/`lines`（`trackId` 缺省）/`lrcName`，`offsetY` 恒为 0，
  与旧版单字幕组工程/job 完全兼容；额外字幕组（id≥1）存于 store 新增的 `tracks: CaptionTrack[]`。
  行 id 全局唯一（跨全部字幕组 + 独立文字块共用一个计数），`loadLrcToTrack(id, text, name)` 是
  非破坏性版本的 `loadLrc`——只替换指定字幕组自己的行，不影响其它字幕组/文字块/撤销历史。
- 图片库（`ImageAsset[]`，store 的 `images`）：已导入图片的登记表，`addImage` 按 `path` 去重、
  id 取现有最大值+1（与 `addTrack` 同一铸造方式，不用模块级计数器——否则 `hydrate` 载入已有
  图片后下一次 `addImage` 会撞 id）。当前唯一的"用途"是 `style.bgImage`（背景图路径）；
  `removeImage` 删除的若正是当前背景图，一并清空 `bgImage`。与字幕组一样是独立资源，
  `loadLrc`（顶栏「导入歌词」的整份重置）不清空图片库——图片和歌词内容无关，不因换了首歌就作废。
- 工程文件 `.alicecut.json` = `{ version: 4, meta, lines, style, lrcName, tracks, images, clips }`
  （媒体只存路径不内嵌）；v1 的 `audioPath` 载入时自动转为一条音轨线段；旧版本缺 `tracks`/
  `images` 字段的工程视为空（`[]`），缺的字段自动补默认值。

## 4. 特效系统（src/core/effects/）

每个特效是一个 `EffectPreset`，两类动画通道：

**① 单元进场（逐字/逐词）**：`apply(args) → CharFx{dx,dy,scale,rotate,alpha,blur,glow}`
纯函数，输入单元进场进度（0..1）等，输出该字符此刻的变换。
预设：逐字弹出 pop / 缩放冲击 punch（错落构图+逐词）/ 滑动错落 slide / 打字机 typewriter / 发光渐显 glow。

**② 行级停靠转场（整句）**：`lineTransition { maxDepth, enterFrom(args), pose(depth, args) }`
整句作为一个块绕画面中心变换。旧行不消失而是**停靠**：每当新行进场，
所有行从 `pose(depth-1)` 联动过渡到 `pose(depth)`，新行从 `enterFrom` 过渡到 `pose(0)`；
深度超过 `maxDepth` 的行在转场中淡出。停靠位置基于渲染器实测的各行包围盒（`blocks[]`），
紧靠排布不重叠。
预设：上移切换 rise（旧行缩放后堆叠在新行上方，保留 3 条历史）/
翻转切换 flip（旧行翻转 90° 竖排停靠侧边，左右交替，垂直居中对齐）/
翻转·底对齐 flip-bottom（同 flip，但竖排块下边缘与新行块下边缘对齐）。

新增特效 = 新增一个文件 + 注册进 `EFFECTS` 数组，UI 与 CLI 自动可用。

## 5. 渲染管线（src/core/render.ts）

每帧流程：背景（纯色/渐变）→ 背景视频层（可选 `drawBackdrop` 回调，调用方提供：
预览取播放中的元素帧、导出取精确 seek 后的帧；cover 铺满裁切）→
按 `trackId` 把歌词行分组（缺省 = 主字幕组 0）→ 对每个可见字幕组独立走一遍
`drawLyricFlow`：片头歌名淡入（仅最早可见字幕组）→ 找当前行（该组内最后一个已开始的行）→
当前行若是停靠式特效则由它统一绘制自己 + 历史行（`drawLineStack`）→
其余行按各自特效走单元进场路径，默认退场为淡出上浮 → 独立文字块画在最上层（与字幕组无关）。
In/Out 窗口始终位于行自身 `[start, end)` segment 内：In 从 start 开始，Out 在 end 结束。GUI 修改时后改的一侧优先并缩短另一侧；单条命令同时给出两者时 In 优先。
每行的特效（`line.effectId ?? style.effectId`）与位置偏移（`line.dx/dy`）在此生效；
字幕组自己的 `offsetY` 叠加在同一路径上（`renderFrame` 的 `opts.tracks`，缺省 = 单字幕组 `offsetY 0`，
向后兼容不知道字幕组概念的旧调用方）。排版结果按（行、文本、字号、字体、构图、画布尺寸）缓存。

## 6. 导出管线

```
runExport（渲染进程）                      exporter.ts（主进程）
H.264 + 硬件加速 + fast：
  GPU Canvas → VideoFrame → VideoEncoder
  Annex B 压缩块（约 KB/帧）────IPC────▶  -f h264 -i pipe:0 -c:v copy

raw fallback（软件/HEVC/ProRes/exact）：
无视频线段：
  静态背景画一次 → PNG ───────────────▶  临时 background.png
  每帧 clear + renderFrame(skipBackground)  pipe:0 = 透明 RGBA 文字层
  getImageData → Uint8Array  ──IPC──▶  -loop 1 -i background.png
                                          overlay → 编码

有视频线段：
  对每个可见视频线段就位到源时间
  renderFrame(ctx, …, n·1000/fps, 视频背景层)
  完整 RGBA 帧 ───────────────IPC────▶  pipe:0 → 编码

两条路径共同：                              每条音轨一个输入 + filter_complex
  exportEnd ──────────────────────▶        -t 成片时长 → mp4/mov
```

- **GPU 驻留 H.264 路径（`src/webcodecsExport.ts`）**：GUI 勾选硬件加速（默认）且取景模式为
  `fast` 时，先用 `VideoEncoder.isConfigSupported` 探测 H.264 High Profile Annex B；支持则 Canvas
  不设置 `willReadFrequently`，每帧直接包装为 `VideoFrame` 交给 WebCodecs。编码后的 KB 级 chunk
  经现有 IPC 写入 FFmpeg，FFmpeg 只做 `-c:v copy` 封装与原有音频滤镜，不再接触未压缩像素。
  编码队列和 IPC 写入都有背压；每 2 秒强制关键帧。HEVC、ProRes、软件编码、`exact` 模式或
  WebCodecs 不支持时保留 raw fallback。CLI 需同时设置 `"hwAccel":"auto"` 与 `"gpu":true`；
  默认仍关闭 Chromium GPU，保证 CI/xvfb 兼容。
- **静态背景走 FFmpeg 合成**：工程没有视频线段时，纯色、渐变、背景图片先在 Canvas 按最终
  尺寸画一次并编码为 PNG。之后 Canvas 每帧只清空并绘制透明文字层；主进程把 PNG 写入独立
  临时目录，以 `-loop 1 -framerate <fps> -i background.png` 作为输入 1，再用 `overlay` 把
  stdin 的 RGBA alpha 帧合成到背景上。音频输入从索引 2 开始，仍与同一个 `filter_complex`
  组合；成功、失败启动和取消都会清理临时目录。只要工程包含任意视频线段，就保持完整 Canvas
  合成路径，因为视频线段还包含时间轴修剪、循环、层序、变换和转场。
  这条路径省掉了 Chromium 每帧重画和合成背景的工作，但透明帧目前仍是全画布 RGBA，
  raw fallback 的 `getImageData` 与单帧字节量尚未减少；H.264 WebCodecs 路径已绕开它，若要继续
  加速 raw fallback，仍需原生 compositor 或稀疏/裁剪 overlay。
- **背景视频走画布**：渲染进程逐帧让 `<video>` 元素就位到 `clipSourceTime` 算出的源时间再按
  层序 + 平移/缩放 drawImage，循环/修剪/变速/层叠与预览同一套计算，画面所见即所得。
  「就位」方式由 `videoFrameMode` 决定（`src/mediaPool.ts`）：
  - **`'fast'`（默认）—— `waitForSourceTime`**：让视频正向连续播放，用
    `requestVideoFrameCallback` 追踪最近解码到的源时间，只在"新可见"或"循环从头开始"时
    重新 seek 一次（之后靠正向播放追帧，不必每帧 seek）。实测比逐帧精确 seek 快一个数量级
    （~28x，见 §9 决策表）——原因是浏览器正向播放解码的速度远快于"每帧 seek 并等
    `seeked` 事件"这套专为偶发交互式拖动设计的 API。代价：同一次导出重跑两遍时视频画面
    可能有亚帧级别的细微差异（见 §2 例外条款）。
  - **`'exact'`——`seekClipExact`**：原来的逐帧精确 seek+等 `seeked`，慢但同一次导出重跑
    字节级一致。连续两帧若落在同一源时间（固定小 epsilon，见 `SEEK_DEDUP_EPS_SEC`）会跳过
    重复 seek，是这条慢路径上的窄范围优化，帮不上源/输出帧率不对齐的大头成本。
  - 两条路径通过 `requestVideoFrameCallback` 是否存在探测切换（这台机器上验证过 Electron 33 /
    Chromium 130+ 支持），不支持的环境自动退化为 `'exact'`。
- **音轨走 ffmpeg**：每条音轨一个输入，滤镜链
  `atrim`（修剪区间）→ `atempo` 链（变速不变调，0.25–4 分解为 ≤2 级）→
  `aresample=48k` + `aloop`（n-1 次 / -1 无限）→ `adelay`（起点平移），
  多条时 `amix` 混音，最后 `-t` 按成片时长截断（无限循环靠它收尾）。
  视频文件也可直接作为音轨输入（`[i:a]` 流），即「提取音频」。
- **编码参数解析（`electron/exporterCore.ts` + `exporter.ts`）**：`EncodeSettings =
  {container, codec, speed, hwAccel}`。纯参数表/分支逻辑在 `exporterCore.ts`（无 IO，单测覆盖）；
  `exporter.ts` 负责探测——`hwAccel:'auto'` 时按平台顺序尝试硬件编码器
  （Windows: nvenc→qsv→amf；macOS: videotoolbox；Linux 本轮不支持硬件路径），
  用该 codec 的真实 `speed:'balanced'` 参数跑一次极小的探测编码（而非裸 `-c:v` 名字），
  只认 `code===0`（ffmpeg 失败退出码并不统一是 1），第一个成功的按 app 运行期缓存
  （含"全部失败→回退软件"这个负例，避免每次导出都重新探测一遍）；探测/回退全程静默但会
  `console.warn` 到主进程终端，不会导出失败。`hwAccel:'software'` 完全跳过探测。
  **默认设置 `{mp4, h264, balanced, software}` 产出的 ffmpeg 参数与本节改动前完全字节级一致**
  （`-preset medium -crf 18 -pix_fmt yuv420p`），存量导出行为不变。

- **重复帧跳过（`renderFingerprint`，`src/core/render.ts`）**：画面是 `tMs` 的纯确定性函数，
  导出循环对无可见视频线段的帧先算"帧指纹"——把这一帧会画到的所有随时间变化的量
  （逐字符 CharFx、高亮块姿态、光标闪烁相位、进/退场与停靠转场进度、片头淡入淡出透明度）
  序列化成字符串。与上一帧指纹相同 ⇒ 像素完全一致，复用上一帧，跳过
  seek/渲染/`getImageData` 回读。歌词视频的静止停留（进场完成后到行结束、行间空档、
  卡拉OK同词稳定区、光标同相位区间）占大头，收益显著且逐字节等价（不破坏 §2 确定性，
  `'exact'` 模式同样适用）。`fp*` 系列函数与 `draw*` 系列一一对应，改渲染遍历结构时必须同步；
  持续动画特效（wobble 噪声、glow 脉冲）指纹每帧都变，自然不跳帧。插件特效走同一
  `apply`/`pose` 求值路径，无需声明任何标志。raw fallback 会把连续重复帧合成一次
  `exportFrame(frame, repeat)` IPC，主进程严格串行写 `repeat` 份，避免重复克隆 8.3MB 缓冲。

**2026-07-18 基准（同机、1080×1920、30fps、8 秒、balanced）**：静态背景从 15.429s 降到
5.826s（快 62.2%）；背景视频从 20.592s 降到 11.329s（快 45.0%）。软件 raw 路径仅靠
重复帧 IPC 合批从 15.429s 降到 14.233s（快 7.8%）。静态项目软件/WebCodecs 成片逐帧
SSIM = 0.996893，分辨率、帧率、时长及 AAC 192k 音轨一致。仓库内可重复基准连续两次测得
静态快 55.1–61.3%、视频快 40.9–48.9%，均超过 30% 目标。

时长 = max(歌词结尾 + 2s, 有限媒体线段最晚结束)。GUI 导出弹窗与无头模式共用 `runExport`。

## 7. 无头 / Pipeline 模式

同一个 Electron 二进制，加 `--export` 参数即进入无头模式（隐藏窗口、软件渲染、无任何交互）：

```bash
# 开发环境
npx electron . --export job.json
# 打包后
alicecut.exe --export job.json
```

### job.json 格式（参考 samples/job.example.json）

| 字段 | 必填 | 说明 |
|---|---|---|
| `lrc` | ✔ | 歌词文件路径（相对路径相对 job 文件所在目录） |
| `out` | ✔ | 输出视频路径（目录自动创建）；`codec:"prores"` 时必须以 `.mov` 结尾（硬校验，见下） |
| `audio` | | 音轨：路径字符串 / `{path, start, loop}` / 数组；多条自动混音 |
| `video` | | 背景视频：写法同 `audio`，cover 铺满画布，文字画在其上 |
| `duration` | | 成片时长（秒）；缺省按歌词与有限媒体线段推算 |
| `fps` | | 10–60，默认 30 |
| `container` | | `"mp4"`（默认）/ `"mov"`；`codec:"prores"` 时会被强制为 `mov`（`out` 扩展名仍须手动匹配，见上） |
| `codec` | | `"h264"`（默认）/ `"hevc"` / `"prores"` |
| `speed` | | `"fast"` / `"balanced"`（默认）/ `"quality"`——编码预设+CRF/码率三档，默认档产出与不填字段完全一致 |
| `hwAccel` | | `"auto"` / `"software"`（默认）；`"auto"` 按平台探测硬件编码器，找不到自动回退软件，不会导出失败 |
| `gpu` | | `true` 时无头 Chromium 保持 GPU 开启，并允许 H.264 WebCodecs 快速路径；缺省 `false`，适合 CI/xvfb。通常与 `"hwAccel":"auto"` 一起使用 |
| `videoFrameMode` | | `"fast"`（默认，背景视频正向连续播放追帧，快很多）/ `"exact"`（逐帧精确 seek，慢但同一次导出重跑字节级一致）；只在有背景视频时有意义 |
| `style` | | 覆盖默认样式：`aspect`（"9:16"/"16:9"/"1:1"）、`effectId`（全局默认特效）、`fontFamily`、`fontSize`、`fontWeight`、`italic`、`textColor`、`textAlpha`、`letterSpacing`/`wordSpacing`/`lineSpacing`、`textAlign`、`textOrientation`、`strokeColor`/`strokeWidth`/`strokeAlpha`、`textBgColor`/`textBgAlpha`（字幕底色）、`halo`/`glowColor`（光晕）、`shadowColor`/`shadowAlpha`/`shadowBlur`/`shadowOffset`（阴影）、`bgType`（solid/gradient/image）/`bgFrom`/`bgTo`/`bgAngle`/`bgImage`（图片路径）、`globalDx`/`globalDy`/`globalRotate`（全局文字变换）、`intensity`、`showMeta` 等 |
| `lineEffects` | | 行级特效：`{"0-7": "rise", "9": "punch"}`，键为行序号或区间，值为特效 id |
| `lineEffectsOut` | | 行级退场特效：`{"0-7": "evaporate-out"}`，键格式与 `lineEffects` 相同 |
| `lineEffectDurations` | | 行级 In/Out 时长（秒）：`{"0-7":{"in":0.6,"out":0.4}}` |
| `lineStyles` | | 行级文字样式覆盖：`{"0-7": {"textAlign": "left", "strokeWidth": 5}}`，键为行序号或区间，值为文字样式字段 |
| `texts` | | 独立文字块数组（不参与歌词流），见 §3 |
| `tracks` | | 额外字幕组数组（多语言字幕），每项 `{name?, lrc, offsetY?, visible?, lineEffects?, lineEffectsOut?, lineStyles?}`；`lrc` 写法同顶层 `lrc`，行级设置的行序号是该字幕组自己的（从 0 数，与顶层行号是两套独立编号）；按数组顺序依次生成，保证与手动在 GUI 里逐个「新增字幕组」得到同样的 trackId |

内置 47 个特效。通用/停靠类包括 `none`、`pop`、`punch`、`slide`、`typewriter`、`glow`、`karaoke`、
`highlight-box`、`bounce`、`streak`、`wobble`、`wipe`、`iris`、`clock-wipe`、`flip`、
`flip-bottom`、`rise`；另有 15 个仅进场和 15 个仅退场的方向性效果，完整 id 见使用手册 §7.2。

### 输出协议

- stdout 逐行进度：`[export] 37%`，完成时 `[export] done: <路径>`，告警/信息也走 `[export] ` 前缀
- 退出码：`0` 成功，`1` 失败（错误详情在 stderr）
- 实现：主进程解析 job → 读 lrc、校验媒体文件存在 → 隐藏 BrowserWindow；渲染进程启动时
  经 `media://` 协议探测媒体时长、把线段装入 store，
  `getHeadlessJob()` 非空则跳过 UI，复用 store 加载逻辑 + `runExport`，
  经 `headlessDone` 上报退出码。

### 运维注意

- Windows / macOS：直接运行即可（无头时自动 `disableHardwareAcceleration`，无 GPU 环境可用）
- Linux CI 容器：需要 `xvfb-run electron . --export job.json`（Chromium 需要 display server）
- 字体：三款首装字体位于 `public/fonts/` 并随构建打包；其余字体位于 Git LFS 管理的 `font-assets/`，客户端按需从 GitHub 下载并缓存；
  job 指定系统字体时需保证 pipeline 机器装有该字体，否则回退默认

### 命令控制台（实时版 CLI）

GUI 底部可展开一个命令控制台（默认收起），接受与 job.json **同名同义**的 JSON 命令
（`lrc`/`tracks`/`audio`/`video`/`texts`/`style`/`lineEffects`/`lineEffectsOut`/`lineStyles`，不含
`out`/`fps`/`duration`——那三个是导出专属参数），实时应用到当前打开的工程。选它而不是设计一套
独立的终端语法，是为了让"控制台效果 == CLI 效果"是代码结构本身保证的，不是靠两边分别实现再
人工对齐：

```
src/projectCommand.ts   纯粹的"把已解析数据落到 store 上"函数（applyTrack/applyClips/…），
                         从 headlessExport.ts 抽出，两条路径都调这里，逻辑单一来源
src/headlessExport.ts   headless 路径：job 里的文件已由主进程 prepareJob 预先读成文本/校验好，
                         直接把结果喂给 projectCommand.ts
src/consoleCommand.ts   控制台路径：收到的是原始 JSON + 文件路径，先经两个新 IPC
                         （file:readText 读文本、job:normalizeClips 归一媒体线段）解析出同样
                         形状的数据，再喂给同一批 projectCommand.ts 函数
```

两条路径唯一的差异只在"文件路径怎么变成数据"，一旦拿到数据，落到 store 上的效果由
`projectCommand.ts` 保证完全一致。

应用顺序固定：`lrc → tracks → audio/video → texts → style → lineEffects → lineEffectsOut → lineStyles`，
好让行级设置有机会命中同一条命令里刚 `lrc`/`tracks` 载入的新行。每个顶层
字段各自 try/catch、各自在回显日志里报告成功/失败，不做"全部成功才生效"的事务——每一步本身
已经在撤销栈上，一步不对 Ctrl+Z 即可，没必要另建回滚机制。

两处刻意偏离严格的 job.json 语义，都是因为"输入一条命令改动正在编辑的工程"和
"headless 从零开始跑一个渲染任务"是不同场景：

- 控制台的顶层 `lrc` 映射到非破坏性的 `loadLrcToTrack(0, …)`，**不是**会清空整份工程（含全部
  字幕组/撤销历史）的 `loadLrc`——后者只保留给顶栏「导入歌词」按钮，命令控制台里打错一个字
  不该抹掉正在编辑的工程。
- `tracks`/`audio`/`video`/`texts` 都是追加语义（`addTrack`/`addClip`/`addLineAt` 永远铸造新
  id，命令里没有"按 id 定位已有项"这回事）——重复运行同一条命令会重复新增，不是幂等更新；
  只有 `style`/`lineEffects`/`lineEffectsOut`/`lineStyles` 是幂等的"设置"操作。这与 job.json 现有语义完全一致，
  只是控制台这种"随手重跑一条命令"的交互方式更容易踩到，在 UI 帮助文案里提示。

## 8. 测试策略

- `vitest` 单测覆盖纯函数核心：LRC 解析、逐字插值、线段时间编辑、排版几何、停靠转场姿态
- `scripts/smoke-export.js`：ffmpeg 管线冒烟（不经渲染器）
- 端到端：`--export` 跑 `samples/smoke.lrc` → ffmpeg 解码验证分辨率/帧率/时长

## 9. 关键技术决策记录

| 决策 | 备选 | 理由 |
|---|---|---|
| Electron + Web Canvas 渲染 | Tauri / Python+Skia / 纯 Node+skia-canvas | 中文排版与字体支持最好；预览/导出/CLI 共享同一渲染引擎，逐像素一致；代价是包体大 |
| Canvas 2D 而非 WebGL/PixiJS | PixiJS | 现有特效（位移/缩放/旋转/blur/shadowBlur 辉光）2D 全够用；长导出无 WebGL context lost 风险；依赖少 |
| WebCodecs H.264 压缩帧 IPC + FFmpeg copy mux，rawvideo 永久回退 | 只用逐帧 rawvideo / MediaRecorder | GPU 合成编码不经过 `getImageData`，实测静态快 62.2%、视频快 45.0%；FFmpeg 继续统一混音/封装。软件、HEVC、ProRes、exact 与无 GPU 环境仍走确定性 raw fallback；MediaRecorder 会被实时播放速度限制 |
| 行级特效存在数据（`line.effectId`）而非 UI 状态 | 单独的特效轨道 | 自然随工程序列化、CLI 可直接赋值、渲染器无需额外查表 |
| 停靠式转场用「按深度 pose + 联动 lerp」模型 | 显式 enter/exit 动画对 | 旧句不消失的需求本质是状态机：每行在第 d 个停靠位，新行进场 = 全体从 pose(d-1) 滑到 pose(d)，一个模型同时覆盖翻转/上移/未来更多排布 |
| 时间编辑「快照 + 绝对增量」 | 增量累加 | 无累积误差，可拖回原位，多选组移天然一致 |
| 无头模式 = 同一 Electron 二进制加参数 | 独立 Node CLI + skia-canvas | 渲染结果与 GUI 完全一致，零双维护；代价是 CI 需要 xvfb |
| 无视频线段时输出透明文字层，由 FFmpeg 循环一张背景 PNG 再合成 | Canvas 每帧重复合成完整背景 | 静态背景只在 Chromium 画和序列化一次，FFmpeg 得到明确的静止输入；保留同一 `renderFrame` 文字路径和逐帧确定性。当前仍传全尺寸 RGBA alpha 帧，因此这是 compositor 架构的第一步，不等于消除 `getImageData` |
| 内置字体脚本下载、不进 git | 提交 28MB 二进制 | 仓库整洁；缺字体时优雅回退系统字体 |
| 硬件编码：运行期探测+缓存+静默回退，从不假设存在 | 按平台硬编码"这个系统有 X" | 实测同一台 Windows 机器上 QSV 能跑通、NVENC/AMF 初始化失败（无对应硬件）；Windows Media Foundation（`*_mf`）会在没有硬件 MFT 时静默退化成软件 MFT，成功/失败退出码分不清"真硬件"和"MF 自己的软件兜底"，故候选列表故意不含 `*_mf`；macOS/VideoToolbox 本身这一轮没有 Mac 可验证，只能保证"探测失败会正确回退"，不保证"探测成功=画质达标"，如实告知用户 |
| 背景视频取景默认改为正向连续播放追帧（`videoFrameMode:'fast'`），逐帧精确 seek 降级为可选 `'exact'` | 继续只做「同源帧去重」这一窄修正、不碰确定性 | 实测背景视频是导出慢的主因（逐帧 seek 单次约 962ms，一条 8s 背景视频导出约 194s；一条早期 8s 背景视频曾拖垮到 GPU 进程崩溃）。真正的根治确实如上一版决策所说，需要放弃"预览=导出=CLI 逐像素一致"这个核心保证——但那次决策同时说明这该是用户知情决定的架构取舍，不是可以顺手做的性能优化；本轮征得用户明确同意后实现：用真实的 Electron 独立探测脚本验证 `requestVideoFrameCallback` 正向播放追帧比逐帧 seek 快约 28x（不是猜测），且只对背景视频画面产生亚帧级别的、有界的近似（文字/音频/无背景视频的导出不受影响），故默认改为 `'fast'`；需要字节级可重现时仍可切回 `'exact'`（原「同源帧去重」优化保留在这条慢路径里） |

## 10. 未来方向

- 音频 BPM 检测辅助卡点、波形显示在时间轴上
- 打包分发（electron-builder；注意 ffmpeg-static 需 asarUnpack）
- 更多构图模板（竖排、对角线、画面分区）
