import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { runHeadlessJob } from './headlessExport'
import { useProject } from './store/project'
import { availableLanguages, detectLocale } from './i18n'
import { registerStoredPacks, loadLocalePref, saveLocalePref } from './i18n/packs'
import './styles.css'

async function bootstrap(): Promise<void> {
  // --export job.json 启动时主进程会给出任务：跳过 UI 直接跑导出
  const job = await window.desktop.getHeadlessJob()
  if (job) {
    void runHeadlessJob(job)
    return
  }
  // 界面语言：注册已安装语言包 → 用上次选择校正初始语言 → 告知主进程本地化其文案
  registerStoredPacks()
  const initial = loadLocalePref() ?? detectLocale(navigator.language)
  useProject.getState().setLanguages(availableLanguages())
  useProject.getState().setLocale(initial)
  saveLocalePref(initial)
  void window.desktop.setLocale(initial)
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
