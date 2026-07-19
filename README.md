# AliceCut

把 `.lrc` 歌词 + 音频转换成短视频平台风格的「动态歌词视频」（Kinetic Typography 文字向视频）：
逐字/逐词卡点出现、错落排版、整句翻转/上移停靠转场，导出带音轨的 MP4。桌面应用 + 无头命令行双形态。

## 特性

- **LRC 全格式解析**：标准行时间戳、增强型逐字标签 `<mm:ss.xx>`、一行多时间戳、`offset`、GBK 自动识别；标准 LRC 自动插值出逐字卡点时间
- **9 种特效**：逐字弹出 / 缩放冲击 / 滑动错落 / 打字机 / 发光渐显 / 卡拉OK高亮（仿 AE/CapCut 自动字幕，当前词放大染色），以及整句停靠转场——翻转切换、翻转·底对齐、上移切换（旧句不消失，停靠在新句侧边/上方）
- **时间轴编辑**：每句歌词是一个线段——拖动挪时间、拖边缘微调起止（逐字节奏按比例保持）、多选/全选；**每行可独立选特效**，也可全局统一
- **背景视频与多音轨**：导入一段或多段视频做背景（**多层叠放/画中画**，竖向拖动换层）、导入多条音频混音；视频/音频都是时间轴上的可拖动线段，支持**循环 n 次 / 无限循环**、**播放头处切割**、**0.25–4 倍变速**（音频变速不变调）、**从视频提取音轨**、**画面平移缩放**（画布上直接拖）
- **字幕与独立文字**：播放头处一键加一句字幕 / 删除选中字幕；可加**独立文字块**（标题/水印），起止自由拖动，特效与字幕共用全部 9 种
- **画布内直接拖动**调整每句歌词的画面位置
- **预览 = 导出**：同一份渲染代码逐帧确定性绘制，预览看到什么导出就是什么
- **导出**：H.264 MP4，9:16 / 16:9 / 1:1，30/60fps，混入音轨；内置 ffmpeg 无需安装
- **Pipeline 友好**：`--export job.json` 无头模式，进度走 stdout、退出码 0/1，可无人值守批量产出
- **背景**：图片（cover 铺满）/ 渐变 / 纯色三选一，可折叠面板
- **字幕样式**：字幕底色块（颜色 + 透明度）、文字透明度、粗体/斜体、光晕、阴影（颜色/偏移/模糊）、**全局文字平移/旋转**，GUI 与 job.json 均可设置
- 内置 13 款免费商用中文字体（得意黑、霞鹜文楷、庞门正道系列、站酷系列、江西拙楷、锐字真言体），**可视化字体选择**（每个字体以自身渲染预览），支持导入任意 ttf/otf；工程保存/载入

## 快速开始

```bash
npm install
npm run fonts        # 可选：下载内置开源字体（否则回退系统字体）
npm run dev          # 启动桌面应用
```

导入歌词（`samples/demo.lrc` 可练手）→ 导入音频 → 空格预览 → 右侧调样式特效 → 导出视频。

## 命令行 / Pipeline

```bash
npx electron . --export job.json
```

```json
{
  "lrc": "song.lrc",
  "audio": "song.mp3",
  "video": [{ "path": "bg.mp4", "start": 0, "loop": "infinite" }],
  "out": "output/video.mp4",
  "fps": 30,
  "style": { "aspect": "9:16", "effectId": "flip-bottom" },
  "lineEffects": { "0-7": "rise", "8": "punch" }
}
```

`audio` / `video` 均支持单个路径或线段数组，每段可设 `start`（秒）与 `loop`（次数或 `"infinite"`）。

进度逐行打到 stdout（`[export] 37%`），完成输出 `[export] done: <路径>`，退出码 0/1。
完整字段表与 CI 注意事项见 [使用手册 §13](docs/MANUAL.md#13-命令行--pipeline-自动化)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/MANUAL.md](docs/MANUAL.md) | **使用手册**：全部功能、快捷键、特效详表、job.json 字段、FAQ |
| [docs/DESIGN.md](docs/DESIGN.md) | **设计文档**：架构、数据模型、特效系统、渲染/导出管线、headless 协议、关键决策 |

## 开发

```bash
npm test                        # 单元测试（LRC 解析/逐字时间/排版/转场姿态）
npm run typecheck               # TypeScript 检查
npm run build                   # 生产构建
node scripts/smoke-export.js    # ffmpeg 编码管线冒烟测试
```

### 目录速览

```
electron/   主进程：窗口/文件对话框/ffmpeg 导出/无头模式
src/core/   纯函数核心：LRC 解析、逐字时间、排版、特效、逐帧渲染（全部可单测）
src/store/  zustand 应用状态
src/components/  React UI：预览画布/时间轴/歌词列表/样式面板/导出弹窗
samples/    示例 LRC 与 job.json 模板
docs/       使用手册与设计文档
```

新增一个特效 = 在 `src/core/effects/` 加一个文件并注册进 `EFFECTS` 数组，GUI 与 CLI 自动可用。

## 字体版权

内置字体均为 SIL OFL 开源协议，可随软件分发与商用：
[得意黑 Smiley Sans](https://github.com/atelier-anchor/smiley-sans) ·
[霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai)
