# 设计文档 — 动态歌词视频生成器

把 `.lrc` 歌词 + 音频转换成短视频平台风格的「动态歌词视频」（Kinetic Typography）。
本文档描述整体架构、核心模型、自动化（pipeline）接口与关键技术决策。
使用方法见 [MANUAL.md](MANUAL.md)。

## 1. 目标与形态

- **输入**：`.lrc` 歌词（标准 / 增强型逐字 / GBK / offset / 一行多时间戳）+ 可选音频（mp3/wav/m4a/flac…）
- **输出**：H.264 MP4（30/60fps，可含音轨），分辨率预设 9:16 / 16:9 / 1:1，面向手机端观看
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
- **预览 = 导出 = CLI**：三条路径调同一个 `renderFrame` 和同一个 `runExport` 循环，画面逐像素一致。

### 2.1 模块清单

| 模块 | 职责 |
|---|---|
| `src/core/lrc.ts` | LRC 文本 → `ParsedLrc`（标准/增强/多时间戳/元数据/offset） |
| `src/core/timing.ts` | 逐字时间插值、行结束推算、`shiftLine`/`retimeLine` 线段时间编辑 |
| `src/core/layout.ts` | 字符排版：换行、居中/错落构图，输出 `PlacedChar[]`（确定性随机） |
| `src/core/effects/` | 特效预设（见 §4），`index.ts` 注册表 |
| `src/core/render.ts` | 逐帧绘制入口 + 布局缓存 + 行块测量（`getLineBlockRect` 供选中框） |
| `src/core/easing.ts` | 缓动函数与 `seededRand` |
| `src/core/media.ts` | 媒体线段（背景视频/音轨）纯数据模型：循环展开、源时间取模、时长计算 |
| `src/store/project.ts` | zustand 单 store：歌词/媒体线段/样式/选区/播放标志 + 全部编辑动作 |
| `src/playback.ts` | 播放控制单例：`performance.now` 为唯一时钟源，媒体元素每帧向时钟对齐 |
| `src/mediaPool.ts` | 媒体元素池：每个线段一个 `<video>/<audio>`（media:// 流式读取），预览同步 + 导出精确 seek |
| `src/exportRunner.ts` | 共享导出循环（GUI 与 headless 共用） |
| `src/headlessExport.ts` | 无头模式执行器（复用 store 加载逻辑） |
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
            dx, dy }                 ← 行级画面位置偏移（画布像素）
LrcWord   { text, start, end, chars: LrcChar[] }
LrcChar   { text, start, end }
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
  停靠式特效对文字块演绎为整块 enterFrom → pose(0) 进场。
- 工程文件 `.dlv.json` = `{ version: 2, meta, lines, style, lrcName, clips }`（媒体只存路径不内嵌）；
  v1 的 `audioPath` 载入时自动转为一条音轨线段，缺的字段自动补默认值。

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
片头歌名淡入 → 找当前行（最后一个已开始的行）→
当前行若是停靠式特效则由它统一绘制自己 + 历史行（`drawLineStack`）→
其余行按各自特效走单元进场路径，默认退场为淡出上浮。
每行的特效（`line.effectId ?? style.effectId`）与位置偏移（`line.dx/dy`）在此生效。
排版结果按（行、文本、字号、字体、构图、画布尺寸）缓存。

## 6. 导出管线

```
runExport（渲染进程）                      exporter.ts（主进程）
for n in 0..totalFrames:
  对每个可见视频线段精确 seek（seeked 事件）
  renderFrame(ctx, …, n·1000/fps, 视频背景层)
  getImageData → Uint8Array  ──IPC──▶  ffmpeg.stdin.write(frame)
  （await = 背压：写满等 drain）            -f rawvideo -pix_fmt rgba
                                          每条音轨: -stream_loop N -i path
                                          filter: adelay=起点 (+amix 混音)
                                          -c:v libx264 -crf 18 yuv420p
exportEnd ──────────────────────▶        -t 成片时长 → mp4
```

- **背景视频走画布**：渲染进程逐帧把 `<video>` 元素 seek 到 `clipSourceTime` 再按
  层序 + 平移/缩放 drawImage，循环/修剪/变速/层叠与预览同一套计算，画面所见即所得。
- **音轨走 ffmpeg**：每条音轨一个输入，滤镜链
  `atrim`（修剪区间）→ `atempo` 链（变速不变调，0.25–4 分解为 ≤2 级）→
  `aresample=48k` + `aloop`（n-1 次 / -1 无限）→ `adelay`（起点平移），
  多条时 `amix` 混音，最后 `-t` 按成片时长截断（无限循环靠它收尾）。
  视频文件也可直接作为音轨输入（`[i:a]` 流），即「提取音频」。

时长 = max(歌词结尾 + 2s, 有限媒体线段最晚结束)。GUI 导出弹窗与无头模式共用 `runExport`。

## 7. 无头 / Pipeline 模式

同一个 Electron 二进制，加 `--export` 参数即进入无头模式（隐藏窗口、软件渲染、无任何交互）：

```bash
# 开发环境
npx electron . --export job.json
# 打包后
dynamic-caption.exe --export job.json
```

### job.json 格式（参考 samples/job.example.json）

| 字段 | 必填 | 说明 |
|---|---|---|
| `lrc` | ✔ | 歌词文件路径（相对路径相对 job 文件所在目录） |
| `out` | ✔ | 输出 mp4 路径（目录自动创建） |
| `audio` | | 音轨：路径字符串 / `{path, start, loop}` / 数组；多条自动混音 |
| `video` | | 背景视频：写法同 `audio`，cover 铺满画布，文字画在其上 |
| `duration` | | 成片时长（秒）；缺省按歌词与有限媒体线段推算 |
| `fps` | | 10–60，默认 30 |
| `style` | | 覆盖默认样式：`aspect`（"9:16"/"16:9"/"1:1"）、`effectId`（全局默认特效）、`fontFamily`、`fontSize`、`fontWeight`、`italic`、`textColor`、`textAlpha`、`textBgColor`/`textBgAlpha`（字幕底色）、`halo`/`glowColor`（光晕）、`shadowColor`/`shadowAlpha`/`shadowBlur`/`shadowOffset`（阴影）、`bgType`/`bgFrom`/`bgTo`/`bgAngle`、`intensity`、`showMeta` 等 |
| `lineEffects` | | 行级特效：`{"0-7": "rise", "9": "punch"}`，键为行序号或区间，值为特效 id |

特效 id：`pop` `punch` `slide` `typewriter` `glow` `flip` `flip-bottom` `rise`。

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
- 字体：内置字体经 `npm run fonts` 下载到 `public/fonts/`（不进 git，构建时打包）；
  job 指定系统字体时需保证 pipeline 机器装有该字体，否则回退默认

## 8. 测试策略

- `vitest` 单测覆盖纯函数核心：LRC 解析、逐字插值、线段时间编辑、排版几何、停靠转场姿态
- `scripts/smoke-export.js`：ffmpeg 管线冒烟（不经渲染器）
- 端到端：`--export` 跑 `samples/smoke.lrc` → ffmpeg 解码验证分辨率/帧率/时长

## 9. 关键技术决策记录

| 决策 | 备选 | 理由 |
|---|---|---|
| Electron + Web Canvas 渲染 | Tauri / Python+Skia / 纯 Node+skia-canvas | 中文排版与字体支持最好；预览/导出/CLI 共享同一渲染引擎，逐像素一致；代价是包体大 |
| Canvas 2D 而非 WebGL/PixiJS | PixiJS | 现有特效（位移/缩放/旋转/blur/shadowBlur 辉光）2D 全够用；长导出无 WebGL context lost 风险；依赖少 |
| 逐帧 rawvideo 喂 ffmpeg stdin | 录屏 / MediaRecorder | 离线逐帧 = 确定性、不掉帧、速度只受 CPU 限制；MediaRecorder 是实时有损路径 |
| 行级特效存在数据（`line.effectId`）而非 UI 状态 | 单独的特效轨道 | 自然随工程序列化、CLI 可直接赋值、渲染器无需额外查表 |
| 停靠式转场用「按深度 pose + 联动 lerp」模型 | 显式 enter/exit 动画对 | 旧句不消失的需求本质是状态机：每行在第 d 个停靠位，新行进场 = 全体从 pose(d-1) 滑到 pose(d)，一个模型同时覆盖翻转/上移/未来更多排布 |
| 时间编辑「快照 + 绝对增量」 | 增量累加 | 无累积误差，可拖回原位，多选组移天然一致 |
| 无头模式 = 同一 Electron 二进制加参数 | 独立 Node CLI + skia-canvas | 渲染结果与 GUI 完全一致，零双维护；代价是 CI 需要 xvfb |
| 内置字体脚本下载、不进 git | 提交 28MB 二进制 | 仓库整洁；缺字体时优雅回退系统字体 |

## 10. 未来方向

- 背景图片 / 背景视频（导出管线需加合成）
- 音频 BPM 检测辅助卡点、波形显示在时间轴上
- 打包分发（electron-builder；注意 ffmpeg-static 需 asarUnpack）
- 更多构图模板（竖排、对角线、画面分区）
