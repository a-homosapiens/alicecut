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

const api = {
  openLrc: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openLrc'),
  openAudio: (): Promise<OpenedBinaryFile | null> => ipcRenderer.invoke('file:openAudio'),
  openFont: (): Promise<OpenedBinaryFile | null> => ipcRenderer.invoke('file:openFont'),
  saveVideoPath: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveVideoPath', defaultName),
  saveProject: (json: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveProject', json, defaultName),
  openProject: (): Promise<OpenedTextFile | null> => ipcRenderer.invoke('file:openProject'),
  readBinary: (path: string): Promise<OpenedBinaryFile | null> =>
    ipcRenderer.invoke('file:readBinary', path),

  exportStart: (opts: {
    width: number
    height: number
    fps: number
    audioPath: string | null
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
