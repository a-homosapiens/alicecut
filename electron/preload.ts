import { contextBridge, ipcRenderer } from 'electron'
import type { HeadlessClip, HeadlessJobPayload, JobClipSpec } from './headless'
import type { EncodeSettings, VideoInputKind } from './exporterCore'
import type { AppMenuState, MenuCommand } from './menu'

export interface OpenedTextFile {
  path: string
  name: string
  text: string
}

export interface OpenedBinaryFile {
  path: string
  name: string
  data: ArrayBuffer
}

export interface PickedMediaFile {
  path: string
  name: string
}

const api = {
  openLrc: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openLrc'),
  openAudio: (): Promise<PickedMediaFile[] | null> => ipcRenderer.invoke('file:openAudio'),
  openVideo: (): Promise<PickedMediaFile[] | null> => ipcRenderer.invoke('file:openVideo'),
  openImage: (): Promise<PickedMediaFile | null> => ipcRenderer.invoke('file:openImage'),
  openFont: (): Promise<OpenedBinaryFile | null> => ipcRenderer.invoke('file:openFont'),
  downloadFont: (url: string): Promise<ArrayBuffer> => ipcRenderer.invoke('font:download', url),
  saveVideoPath: (defaultName: string, ext: 'mp4' | 'mov'): Promise<string | null> =>
    ipcRenderer.invoke('file:saveVideoPath', defaultName, ext),
  saveProject: (json: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveProject', json, defaultName),
  saveSrt: (text: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveSrt', text, defaultName),
  openProject: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openProject'),
  rememberProjectPath: (path: string): Promise<void> => ipcRenderer.invoke('file:rememberProjectPath', path),
  confirmUnsaved: (): Promise<'save' | 'discard' | 'cancel'> => ipcRenderer.invoke('app:confirm-unsaved'),
  confirmLyricsImport: (): Promise<'replace' | 'add' | 'cancel'> =>
    ipcRenderer.invoke('app:confirm-lyrics-import'),
  confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirm-close'),
  onCloseRequested: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('app:request-close', h)
    return () => ipcRenderer.removeListener('app:request-close', h)
  },
  openPlugin: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openPlugin'),
  openLanguage: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openLanguage'),
  saveLanguageTemplate: (text: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveLanguageTemplate', text, defaultName),

  /** 界面语言：渲染进程切换后告知主进程，使其菜单/对话框/窗口标题随之本地化 */
  setLocale: (locale: string): Promise<void> => ipcRenderer.invoke('app:set-locale', locale),
  fileExists: (path: string): Promise<boolean> => ipcRenderer.invoke('file:exists', path),
  /** 命令控制台专用：按绝对路径读文本文件；路径非绝对/读取失败均返回 null */
  readText: (path: string): Promise<string | null> => ipcRenderer.invoke('file:readText', path),
  /** 命令控制台专用：把 audio/video 字段归一成可直接 addClip 的线段列表（复用 job.json 的解析逻辑） */
  normalizeClips: (
    kind: 'video' | 'audio',
    spec: string | JobClipSpec | (string | JobClipSpec)[]
  ): Promise<HeadlessClip[]> => ipcRenderer.invoke('job:normalizeClips', kind, spec),
  mediaHasAudio: (path: string): Promise<boolean> => ipcRenderer.invoke('media:hasAudio', path),

  /** 导入归一化：返回可播放路径（不支持的视频会被转成 H.264 MP4 并缓存） */
  ensurePlayable: (path: string): Promise<{ path: string; converted: boolean }> =>
    ipcRenderer.invoke('media:ensurePlayable', path),
  onConvertProgress: (cb: (p: { name: string; frac: number }) => void): (() => void) => {
    const h = (_e: unknown, p: { name: string; frac: number }): void => cb(p)
    ipcRenderer.on('media:convertProgress', h)
    return () => ipcRenderer.removeListener('media:convertProgress', h)
  },

  /** 把菜单状态（文案/面板清单/勾选/置灰）推给主进程重建原生菜单 */
  setMenuState: (state: AppMenuState): void => ipcRenderer.send('menu:state', state),
  /** 原生菜单里点了某条命令 */
  onMenuCommand: (cb: (cmd: MenuCommand) => void): (() => void) => {
    const h = (_e: unknown, c: MenuCommand): void => cb(c)
    ipcRenderer.on('menu:command', h)
    return () => ipcRenderer.removeListener('menu:command', h)
  },
  /** 原生菜单「视图 › 面板」里勾掉/勾上某个面板 */
  onMenuTogglePanel: (cb: (id: string) => void): (() => void) => {
    const h = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('menu:togglePanel', h)
    return () => ipcRenderer.removeListener('menu:togglePanel', h)
  },

  exportStart: (opts: {
    width: number
    height: number
    fps: number
    audioClips: {
      path: string
      startMs: number
      sourceInMs: number
      sourceOutMs: number
      speed: number
      loop: number | 'infinite'
      fadeInMs: number
      fadeOutMs: number
      volume: number
    }[]
    durationSec: number
    outPath: string
    encode: EncodeSettings
    videoInput?: VideoInputKind
    staticBackgroundPng?: Uint8Array
  }): Promise<void> => ipcRenderer.invoke('export:start', opts),
  exportFrame: (frame: Uint8Array, repeat = 1): Promise<void> => ipcRenderer.invoke('export:frame', frame, repeat),
  exportEnd: (): Promise<{ code: number; log: string }> => ipcRenderer.invoke('export:end'),
  exportCancel: (): Promise<void> => ipcRenderer.invoke('export:cancel'),

  /** 无头导出模式：GUI 启动时返回 null */
  getHeadlessJob: (): Promise<HeadlessJobPayload | null> => ipcRenderer.invoke('headless:job'),
  headlessProgress: (frac: number): void => ipcRenderer.send('headless:progress', frac),
  headlessLog: (msg: string): void => ipcRenderer.send('headless:log', msg),
  /** 无头模式：直接写 .alicecut.json 到指定路径（不弹保存对话框） */
  saveProjectHeadless: (json: string, path: string): Promise<void> =>
    ipcRenderer.invoke('file:saveProjectHeadless', json, path),
  headlessDone: (r: { code: number; log: string }): Promise<void> =>
    ipcRenderer.invoke('headless:done', r)
}

export type DesktopApi = typeof api

contextBridge.exposeInMainWorld('desktop', api)
