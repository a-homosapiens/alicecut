import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { runHeadlessJob } from './headlessExport'
import './styles.css'

async function bootstrap(): Promise<void> {
  // --export job.json 启动时主进程会给出任务：跳过 UI 直接跑导出
  const job = await window.desktop.getHeadlessJob()
  if (job) {
    void runHeadlessJob(job)
    return
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
