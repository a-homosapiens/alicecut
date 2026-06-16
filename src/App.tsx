import { useEffect, useState } from 'react'
import { useProject } from './store/project'
import { clipEnd, type MediaClip } from './core/media'
import { probeMediaDuration } from './mediaPool'
import { toggle } from './playback'
import { PreviewCanvas } from './components/PreviewCanvas'
import { TransportBar } from './components/TransportBar'
import { Timeline } from './components/Timeline'
import { LyricsPanel } from './components/LyricsPanel'
import { StylePanel } from './components/StylePanel'
import { ExportDialog } from './components/ExportDialog'

export function App(): React.JSX.Element {
  const lrcName = useProject((s) => s.lrcName)
  const clips = useProject((s) => s.clips)
  const hasLines = useProject((s) => s.lines.length > 0)
  const videoCount = clips.filter((c) => c.kind === 'video').length
  const audioCount = clips.filter((c) => c.kind === 'audio').length
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
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        const st = useProject.getState()
        if (st.selectedClipId !== null) st.removeClip(st.selectedClipId)
        else if (st.selectedIds.length > 0) st.removeLines(st.selectedIds)
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

  /** 把一批文件追加为媒体线段：同类线段依次首尾相接排在时间轴上 */
  const addMediaClips = async (
    kind: 'video' | 'audio',
    files: { path: string; name: string }[]
  ): Promise<void> => {
    for (const file of files) {
      let sourceDuration: number
      try {
        sourceDuration = await probeMediaDuration(file.path, kind)
      } catch (err) {
        alert(String(err instanceof Error ? err.message : err))
        continue
      }
      const st = useProject.getState()
      const sameKind = st.clips.filter((c) => c.kind === kind && c.loop !== 'infinite')
      const start = sameKind.reduce((acc, c) => Math.max(acc, clipEnd(c, 0)), 0)
      const clip = st.addClip({ kind, path: file.path, name: file.name, start, sourceDuration, loop: 1 })
      st.setSelectedClip(clip.id)
    }
  }

  const importVideo = async (): Promise<void> => {
    const files = await window.desktop.openVideo()
    if (files) await addMediaClips('video', files)
  }

  const importAudio = async (): Promise<void> => {
    const files = await window.desktop.openAudio()
    if (files) await addMediaClips('audio', files)
  }

  const saveProject = async (): Promise<void> => {
    const st = useProject.getState()
    const json = JSON.stringify(
      {
        version: 2,
        meta: st.meta,
        lines: st.lines,
        style: st.style,
        lrcName: st.lrcName,
        clips: st.clips.map(({ id: _id, ...rest }) => rest)
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

      // v1 工程的 audioPath → 一条 0 起点的音轨线段；旧版缺的字段由 addClip 补默认值
      type SavedClip = Partial<MediaClip> & Pick<MediaClip, 'kind' | 'path' | 'name' | 'start' | 'sourceDuration'>
      const saved: SavedClip[] = Array.isArray(data.clips)
        ? data.clips
        : typeof data.audioPath === 'string'
          ? [{ kind: 'audio' as const, path: data.audioPath, name: data.audioPath, start: 0, sourceDuration: 0 }]
          : []

      const missing: string[] = []
      for (const c of saved) {
        if (!(await window.desktop.fileExists(c.path))) {
          missing.push(c.path)
          continue
        }
        // 重新探测时长，文件被替换过也能保持一致
        const sourceDuration = await probeMediaDuration(c.path, c.kind).catch(() => c.sourceDuration)
        useProject.getState().addClip({ ...c, sourceDuration })
      }
      if (missing.length > 0) {
        alert(`以下媒体文件不在原路径，已跳过：\n${missing.join('\n')}`)
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
        <button className="btn" onClick={() => void importVideo()}>
          导入视频 {videoCount > 0 ? `· ${videoCount} 段` : ''}
        </button>
        <button className="btn" onClick={() => void importAudio()}>
          导入音频 {audioCount > 0 ? `· ${audioCount} 条` : ''}
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
