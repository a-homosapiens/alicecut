import { contextBridge, ipcRenderer } from 'electron'
import type { HeadlessJobPayload } from './headless'

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
  saveVideoPath: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveVideoPath', defaultName),
  saveProject: (json: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveProject', json, defaultName),
  saveSrt: (text: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveSrt', text, defaultName),
  openProject: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openProject'),
  openPlugin: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openPlugin'),
  openLanguage: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openLanguage'),
  saveLanguageTemplate: (text: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveLanguageTemplate', text, defaultName),

  /** 界面语言：渲染进程切换后告知主进程，使其菜单/对话框/窗口标题随之本地化 */
  setLocale: (locale: string): Promise<void> => ipcRenderer.invoke('app:set-locale', locale),
  fileExists: (path: string): Promise<boolean> => ipcRenderer.invoke('file:exists', path),
  mediaHasAudio: (path: string): Promise<boolean> => ipcRenderer.invoke('media:hasAudio', path),

  /** 导入归一化：返回可播放路径（不支持的视频会被转成 H.264 MP4 并缓存） */
  ensurePlayable: (path: string): Promise<{ path: string; converted: boolean }> =>
    ipcRenderer.invoke('media:ensurePlayable', path),
  onConvertProgress: (cb: (p: { name: string; frac: number }) => void): (() => void) => {
    const h = (_e: unknown, p: { name: string; frac: number }): void => cb(p)
    ipcRenderer.on('media:convertProgress', h)
    return () => ipcRenderer.removeListener('media:convertProgress', h)
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
    }[]
    durationSec: number
    outPath: string
  }): Promise<void> => ipcRenderer.invoke('export:start', opts),
  exportFrame: (frame: Uint8Array): Promise<void> => ipcRenderer.invoke('export:frame', frame),
  exportEnd: (): Promise<{ code: number; log: string }> => ipcRenderer.invoke('export:end'),
  exportCancel: (): Promise<void> => ipcRenderer.invoke('export:cancel'),

  /** 无头导出模式：GUI 启动时返回 null */
  getHeadlessJob: (): Promise<HeadlessJobPayload | null> => ipcRenderer.invoke('headless:job'),
  headlessProgress: (frac: number): void => ipcRenderer.send('headless:progress', frac),
  headlessLog: (msg: string): void => ipcRenderer.send('headless:log', msg),
  headlessDone: (r: { code: number; log: string }): Promise<void> =>
    ipcRenderer.invoke('headless:done', r)
}

export type DesktopApi = typeof api

contextBridge.exposeInMainWorld('desktop', api)
