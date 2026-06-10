import { useEffect, useState } from 'react'
import { useProject } from './store/project'
import { setAudioSource, toggle } from './playback'
import { PreviewCanvas } from './components/PreviewCanvas'
import { TransportBar } from './components/TransportBar'
import { Timeline } from './components/Timeline'
import { LyricsPanel } from './components/LyricsPanel'
import { StylePanel } from './components/StylePanel'
import { ExportDialog } from './components/ExportDialog'

export function App(): React.JSX.Element {
  const lrcName = useProject((s) => s.lrcName)
  const audio = useProject((s) => s.audio)
  const hasLines = useProject((s) => s.lines.length > 0)
  const [showExport, setShowExport] = useState(false)

  // 快捷键：空格播放/暂停，Ctrl+A 全选线段，Esc 取消选择
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault()
        useProject.getState().selectAll()
      } else if (e.code === 'Escape') {
        useProject.getState().clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const importLrc = async (): Promise<void> => {
    const file = await window.desktop.openLrc()
    if (!file) return
    useProject.getState().loadLrc(file.text, file.name)
    if (useProject.getState().lines.length === 0) {
      alert('未在文件中找到带时间戳（[mm:ss.xx]）的歌词行，请确认是有效的 .lrc 文件')
    }
  }

  const attachAudio = async (file: { path: string; name: string; data: ArrayBuffer }): Promise<void> => {
    const st = useProject.getState()
    const old = st.audio
    if (old) URL.revokeObjectURL(old.url)
    const url = URL.createObjectURL(new Blob([file.data]))
    const duration = await setAudioSource(url)
    st.setAudio({ path: file.path, name: file.name, url, duration })
  }

  const importAudio = async (): Promise<void> => {
    const file = await window.desktop.openAudio()
    if (file) await attachAudio(file)
  }

  const saveProject = async (): Promise<void> => {
    const st = useProject.getState()
    const json = JSON.stringify(
      {
        version: 1,
        meta: st.meta,
        lines: st.lines,
        style: st.style,
        lrcName: st.lrcName,
        audioPath: st.audio?.path ?? null
      },
      null,
      2
    )
    const base = (st.lrcName ?? '未命名').replace(/\.[^.]+$/, '')
    await window.desktop.saveProject(json, `${base}.dlv.json`)
  }

  const openProject = async (): Promise<void> => {
    const file = await window.desktop.openProject()
    if (!file) return
    try {
      const data = JSON.parse(file.text)
      if (!Array.isArray(data.lines)) throw new Error('bad project')
      useProject.getState().hydrate(data)
      if (typeof data.audioPath === 'string') {
        const audio = await window.desktop.readBinary(data.audioPath)
        if (audio) await attachAudio(audio)
        else alert(`找不到工程关联的音频文件：\n${data.audioPath}\n请重新导入音频`)
      }
    } catch {
      alert('工程文件无法解析')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>动态歌词</h1>
        <button className="btn" onClick={() => void importLrc()}>
          导入歌词 {lrcName ? `· ${lrcName}` : ''}
        </button>
        <button className="btn" onClick={() => void importAudio()}>
          导入音频 {audio ? `· ${audio.name}` : ''}
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => void openProject()}>
          打开工程
        </button>
        <button className="btn" disabled={!hasLines} onClick={() => void saveProject()}>
          保存工程
        </button>
        <button className="btn btn-primary" disabled={!hasLines} onClick={() => setShowExport(true)}>
          导出视频
        </button>
      </header>

      <main className="layout">
        <aside className="panel panel-left">
          <LyricsPanel />
        </aside>
        <section className="center">
          <PreviewCanvas />
          <TransportBar />
          <Timeline />
        </section>
        <aside className="panel panel-right">
          <StylePanel />
        </aside>
      </main>

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}
