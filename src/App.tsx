import { useEffect, useState } from 'react'
import { useProject } from './store/project'
import { serializeSrt } from './core/subtitles'
import { loadPluginSource, installPlugin } from './plugins'
import { validatePlugin } from './core/effects/validator'
import { clipEnd, MAX_LAYER, type MediaClip } from './core/media'
import { probeMediaDuration } from './mediaPool'
import { toggle } from './playback'
import { PreviewCanvas } from './components/PreviewCanvas'
import { TransportBar } from './components/TransportBar'
import { Timeline } from './components/Timeline'
import { LyricsPanel } from './components/LyricsPanel'
import { StylePanel } from './components/StylePanel'
import { ExportDialog } from './components/ExportDialog'
import { LanguageMenu } from './components/LanguageMenu'
import { useT } from './i18n'

export function App(): React.JSX.Element {
  const t = useT()
  const lrcName = useProject((s) => s.lrcName)
  const clips = useProject((s) => s.clips)
  const hasLines = useProject((s) => s.lines.length > 0)
  const videoCount = clips.filter((c) => c.kind === 'video').length
  const audioCount = clips.filter((c) => c.kind === 'audio').length
  const [showExport, setShowExport] = useState(false)
  const [convertStatus, setConvertStatus] = useState<{ name: string; frac: number } | null>(null)

  // 导入归一化进度（主进程转视频时推送）
  useEffect(() => window.desktop.onConvertProgress((p) => setConvertStatus(p)), [])

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
      alert(t('app.noLyrics'))
    }
  }

  /**
   * 把一批文件追加为媒体线段。
   * 音频默认分层导入：已有音频时，整批放到新的一层、从红色播放头处首尾相接；
   * 没有音频（或视频）时沿用旧行为——同类线段在第 0 层依次首尾相接。
   */
  const addMediaClips = async (
    kind: 'video' | 'audio',
    files: { path: string; name: string }[]
  ): Promise<void> => {
    const st0 = useProject.getState()
    const existingAudio = st0.clips.filter((c) => c.kind === 'audio')
    const audioToNewLayer = kind === 'audio' && existingAudio.length > 0
    const targetLayer = audioToNewLayer
      ? Math.min(MAX_LAYER, existingAudio.reduce((m, c) => Math.max(m, c.layer), 0) + 1)
      : 0
    // 新层从播放头开始；否则接在同类线段末尾（旧行为）
    let cursor = audioToNewLayer
      ? Math.round(st0.currentTime * 1000)
      : st0.clips
          .filter((c) => c.kind === kind && c.loop !== 'infinite')
          .reduce((acc, c) => Math.max(acc, clipEnd(c, 0)), 0)

    try {
      for (const file of files) {
        // 视频：先归一化为 Chromium 可播放格式（不支持的转成 H.264 MP4）
        let mediaPath = file.path
        if (kind === 'video') {
          try {
            mediaPath = (await window.desktop.ensurePlayable(file.path)).path
          } catch (err) {
            alert(t('app.convertFail') + (err instanceof Error ? err.message : String(err)))
            continue
          }
        }
        let sourceDuration: number
        try {
          sourceDuration = await probeMediaDuration(mediaPath, kind)
        } catch (err) {
          alert(String(err instanceof Error ? err.message : err))
          continue
        }
        const st = useProject.getState()
        const clip = st.addClip({
          kind,
          path: mediaPath,
          name: file.name,
          start: cursor,
          sourceDuration,
          loop: 1,
          layer: targetLayer
        })
        st.setSelectedClip(clip.id)
        cursor = clipEnd(clip, 0) // 同批次首尾相接
      }
    } finally {
      setConvertStatus(null)
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
    const base = (st.lrcName ?? t('app.untitled')).replace(/\.[^.]+$/, '')
    await window.desktop.saveProject(json, `${base}.dlv.json`)
  }

  const exportSrt = async (): Promise<void> => {
    const st = useProject.getState()
    const srt = serializeSrt(st.lines)
    if (!srt) {
      alert(t('app.noSubtitles'))
      return
    }
    const base = (st.lrcName ?? t('app.subtitleDefault')).replace(/\.[^.]+$/, '')
    await window.desktop.saveSrt(srt, `${base}.srt`)
  }

  const importPlugin = async (): Promise<void> => {
    const file = await window.desktop.openPlugin()
    if (!file) return
    try {
      // loadPluginSource 内含 Worker 硬隔离闸门（死循环/逃逸/非确定性）；
      // 通过后再跑同步校验器拿到面向用户的详细报告（范围/性能/源码扫描）
      const { manifest, sandboxed } = await loadPluginSource(file.text)
      const report = validatePlugin(manifest, file.text)
      if (!report.ok) {
        const errs = report.issues
          .filter((i) => i.level === 'error')
          .map((i) => `• ${i.effect ? `[${i.effect}] ` : ''}${i.message}`)
          .join('\n')
        alert(t('app.pluginRejected', { name: report.pluginName, errs }))
        return
      }
      const { pickerEffects, videoTransitions } = installPlugin(manifest)
      const total = pickerEffects.length + videoTransitions.length
      if (total === 0) {
        alert(t('app.pluginNoEffects'))
        return
      }
      useProject.getState().addPluginEffects(pickerEffects)
      useProject.getState().addPluginVideoTransitions(videoTransitions)
      const warns = report.issues.filter((i) => i.level === 'warn').length
      const sb = sandboxed ? '' : t('app.pluginNoSandbox')
      const vt = videoTransitions.length ? t('app.pluginVtSuffix', { n: videoTransitions.length }) : ''
      alert(
        t('app.pluginImported', { name: manifest.name, n: pickerEffects.length }) +
          vt +
          (warns ? t('app.pluginWarnSuffix', { n: warns }) : '') +
          sb
      )
    } catch (err) {
      alert(t('app.pluginImportFail') + (err instanceof Error ? err.message : String(err)))
    }
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
        alert(t('app.mediaMissing', { list: missing.join('\n') }))
      }
    } catch {
      alert(t('app.projectParseFail'))
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t('topbar.title')}</h1>
        <button className="btn" onClick={() => void importLrc()}>
          {t('topbar.importLyrics')} {lrcName ? `· ${lrcName}` : ''}
        </button>
        <button className="btn" onClick={() => void importVideo()}>
          {t('topbar.importVideo')} {videoCount > 0 ? t('topbar.videoSuffix', { n: videoCount }) : ''}
        </button>
        <button className="btn" onClick={() => void importAudio()}>
          {t('topbar.importAudio')} {audioCount > 0 ? t('topbar.audioSuffix', { n: audioCount }) : ''}
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => void importPlugin()} title={t('app.importPluginTitle')}>
          {t('topbar.importPlugin')}
        </button>
        <button className="btn" onClick={() => void openProject()}>
          {t('topbar.openProject')}
        </button>
        <button className="btn" disabled={!hasLines} onClick={() => void saveProject()}>
          {t('topbar.saveProject')}
        </button>
        <button className="btn" disabled={!hasLines} onClick={() => void exportSrt()}>
          {t('topbar.exportSrt')}
        </button>
        <button className="btn btn-primary" disabled={!hasLines} onClick={() => setShowExport(true)}>
          {t('topbar.exportVideo')}
        </button>
        <LanguageMenu />
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

      {convertStatus && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{t('convert.title')}</h2>
            <p className="hint path">{convertStatus.name}</p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(convertStatus.frac * 100).toFixed(1)}%` }} />
            </div>
            <p className="hint">{(convertStatus.frac * 100).toFixed(0)}%</p>
            <p className="hint">{t('convert.hint')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
