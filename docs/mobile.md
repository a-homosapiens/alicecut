# 移动端可行性分析

> 问题：本 app 能否作为手机 app 运行？

## 结论：目前不能（直接）

本应用基于 **Electron**，而 Electron 只面向桌面（Windows/Mac/Linux），iOS/Android 上没有 Electron 运行时。所以现有构建无法直接装到手机上。

但把应用拆成两半看，可移植性差别很大。

## 已经"接近移动端"的部分（编辑器层）

整个渲染/编辑层都是标准 Web 技术，手机浏览器/ WebView 里能跑：

- React + Vite UI
- Canvas 2D 渲染（`renderFrame`、全部文字/视频特效、波形）
- `<video>`/`<audio>` + Web Audio（预览播放、音频淡入淡出）

刚加的时间轴双指捏合缩放也是朝这个方向。

## 不可移植的部分（桌面内核，全在 `electron/`）

- **导出**：`electron/exporter.ts` 用 `child_process` 拉起内置的 **`ffmpeg-static` 原生二进制**，把 Canvas 原始帧（rawvideo rgba）管道喂进去编码 mp4。原生二进制 + 进程 + 帧管道——移动端都不存在。**这是最大的拦路虎。**
- **`electron/main.ts`**：`media://` 自定义协议、原生文件对话框、`fs` 读写。
- **`electron/headless.ts`**：CLI。

## 通往"手机 app"的现实路径

1. **Capacitor 套壳**（要做成可安装的 iOS/Android app，最现实）。复用整套 Web UI；用 Capacitor 插件替换 Electron 主进程 API（文件系统、分享、文件选择）。导出仍需解决——要么用移动端原生 ffmpeg 插件，要么把导出推到服务端。
2. **服务端导出 + 轻客户端**（**我们最有优势的路线**，因为已经做了一半）：headless 模式（`--export job.json`）本质就是个非交互渲染器。把它跑在服务器上，手机只上传歌词/音频/样式，拿回 mp4。手机 app = 本地编辑+预览，云端导出。
3. **PWA / 移动网页**。最快达成，预览/编辑都行；但浏览器内导出要用 `ffmpeg.wasm`——手机上慢且吃内存，短片尚可，长曲很吃力。
4. **React Native**——**不建议**：渲染是 Canvas 的，等于重写内核而非复用。

## 推荐

要做手机端，最干净的拆分是 **移动端（Web 或 Capacitor）负责编辑+预览，服务端负责导出**——几乎复用全部渲染器，并能借力已有的 headless 流水线。唯一真正无法搬到手机上的，是本地 ffmpeg 导出。
