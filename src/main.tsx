import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { runHeadlessJob } from './headlessExport'
import { useProject } from './store/project'
import './styles.css'

async function bootstrap(): Promise<void> {
  // --export job.json 启动时主进程会给出任务：跳过 UI 直接跑导出
  const job = await window.desktop.getHeadlessJob()
  if (job) {
    void runHeadlessJob(job)
    return
  }
  // 界面语言：用主进程持久化值校正初始猜测，并订阅原生菜单切换
  void window.desktop.getLocale().then((l) => useProject.getState().setLocale(l))
  window.desktop.onLocaleChanged((l) => useProject.getState().setLocale(l))
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
