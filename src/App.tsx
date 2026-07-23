import { useEffect, useRef, useState } from 'react'
import { allCaptionTracks, useProject } from './store/project'
import { serializeSrt } from './core/subtitles'
import { loadPluginSource, installPlugin } from './plugins'
import { validatePlugin } from './core/effects/validator'
import { clipEnd, MAX_LAYER } from './core/media'
import { probeMediaDuration } from './mediaPool'
import { parseProjectData, serializeProject } from './projectFile'
import { toggle } from './playback'
import { PreviewCanvas } from './components/PreviewCanvas'
import { TransportBar } from './components/TransportBar'
import { Timeline } from './components/Timeline'
import { TrackList } from './components/TrackList'
import { StylePanel } from './components/StylePanel'
import { ExportDialog } from './components/ExportDialog'
import { CommandConsole } from './components/CommandConsole'
import { ResourceLibrary } from './components/ResourceLibrary'
import { LanguageMenu } from './components/LanguageMenu'
import { Logo } from './components/Logo'
import { Toolbar, type AppCommands } from './components/Toolbar'
import { useWindows, WINDOW_REGISTRY } from './store/windows'
import { usePanels } from './store/panels'
import { useT } from './i18n'
import { importCaptionFile } from './projectCommand'

function activeEditorTarget(): Element | null {
  const target = document.activeElement
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
    !!target?.closest('[contenteditable="true"]') ? target : null
}

export function App(): React.JSX.Element {
  const t = useT()
  const hasProject = useProject((s) => s.lines.length > 0 || s.clips.length > 0 || s.images.length > 0)
  const canSave = useProject((s) => s.dirty || s.lines.length > 0 || s.clips.length > 0 || s.images.length > 0)
  const hasCaptions = useProject((s) => s.lines.some((line) => line.kind !== 'text'))
  const canExport = hasProject
  const locale = useProject((s) => s.locale)
  const hiddenPanels = useWindows((s) => s.hidden)
  const [showExport, setShowExport] = useState(false)
  const [showConsole, setShowConsole] = useState(false)
  const [convertStatus, setConvertStatus] = useState<{ name: string; frac: number } | null>(null)

  // 导入归一化进度（主进程转视频时推送）
  useEffect(() => window.desktop.onConvertProgress((p) => setConvertStatus(p)), [])

  // 快捷键：空格播放/暂停，Ctrl+A 全选线段，Esc 取消选择
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      const editable = activeEditorTarget() !== null
      if (editable || target?.closest('.modal-backdrop')) return
      if (useProject.getState().exporting) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault()
        useProject.getState().selectAllCaptions()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) useProject.getState().redo()
        else useProject.getState().undo()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault()
        useProject.getState().redo()
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
    const hasExistingCaptions = useProject.getState().lines.some((line) => line.kind !== 'text')
    const choice = hasExistingCaptions ? await window.desktop.confirmLyricsImport() : 'replace'
    if (choice === 'cancel') return
    const trackId = importCaptionFile(file.text, file.name, choice)
    if (trackId === null) {
      alert(t('app.noLyrics'))
      return
    }
    if (trackId > 0) usePanels.getState().openPanel(trackId, true)
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
          sourcePath: file.path,
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

  const saveProject = async (): Promise<boolean> => {
    const st = useProject.getState()
    const json = JSON.stringify(serializeProject(st), null, 2)
    const base = (st.lrcName ?? t('app.untitled')).replace(/\.[^.]+$/, '')
    try {
      const path = await window.desktop.saveProject(json, `${base}.alicecut.json`)
      if (!path) return false
      useProject.getState().markSaved()
      alert(`Project saved:\n${path}`)
      return true
    } catch (err) {
      alert(`Could not save project:\n${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  const confirmReplaceProject = async (): Promise<boolean> => {
    if (!useProject.getState().dirty) return true
    const choice = await window.desktop.confirmUnsaved()
    if (choice === 'cancel') return false
    return choice === 'discard' || await saveProject()
  }

  const exportSrt = async (): Promise<void> => {
    const st = useProject.getState()
    const tracks = allCaptionTracks(st).filter((track) =>
      st.lines.some((line) => line.kind !== 'text' && (line.trackId ?? 0) === track.id)
    )
    if (tracks.length === 0) {
      alert(t('app.noSubtitles'))
      return
    }
    let chosen = tracks[0]
    if (tracks.length > 1) {
      const answer = prompt(
        `Choose a subtitle track to export:\n${tracks.map((track, i) => `${i + 1}. ${track.name || track.lrcName || `Track ${track.id + 1}`}${track.visible ? '' : ' (hidden)'}`).join('\n')}`,
        '1'
      )
      if (answer == null) return
      const index = Number(answer) - 1
      if (!Number.isInteger(index) || !tracks[index]) {
        alert('Invalid subtitle track selection.')
        return
      }
      chosen = tracks[index]
    }
    const selectedLines = st.lines.filter((line) => line.kind !== 'text' && (line.trackId ?? 0) === chosen.id)
    const srt = serializeSrt(selectedLines)
    if (!srt) {
      alert(t('app.noSubtitles'))
      return
    }
    const base = (st.lrcName ?? t('app.subtitleDefault')).replace(/\.[^.]+$/, '')
    try {
      const path = await window.desktop.saveSrt(srt, `${base}.srt`)
      if (path) alert(`Subtitles exported:\n${path}`)
    } catch (err) {
      alert(`Could not export subtitles:\n${err instanceof Error ? err.message : String(err)}`)
    }
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

  // 把工程数据（v2 / v1）加载进 store。启动时不自动打开任何工程。
  const loadProjectData = async (data: unknown): Promise<void> => {
    const project = parseProjectData(data)
    const staticImage = (path: string): boolean => /\.(?:jpe?g|png|bmp)$/i.test(path)
    const unsupportedImages = project.images.filter((image) => !staticImage(image.path)).map((image) => image.path)
    project.images = project.images.filter((image) => staticImage(image.path))
    if (project.style.bgImage && !staticImage(project.style.bgImage)) {
      unsupportedImages.push(project.style.bgImage)
      project.style = { ...project.style, bgType: 'solid', bgImage: null }
    }
    const missing: string[] = []
    const clips: Parameters<ReturnType<typeof useProject.getState>['hydrate']>[0]['clips'] = []
    for (const saved of project.clips) {
      const sourcePath = saved.sourcePath ?? saved.path
      let path = saved.path
      if (!(await window.desktop.fileExists(path)) && sourcePath !== path && await window.desktop.fileExists(sourcePath)) {
        path = saved.kind === 'video' ? (await window.desktop.ensurePlayable(sourcePath)).path : sourcePath
      }
      const exists = await window.desktop.fileExists(path)
      const sourceDuration = exists ? await probeMediaDuration(path, saved.kind).catch(() => saved.sourceDuration) : saved.sourceDuration
      if (!exists) missing.push(sourcePath)
      clips.push({ ...saved, path, sourcePath, sourceDuration, offline: !exists })
    }
    const imageChecks = await Promise.all(project.images.map(async (image) => ({ image, exists: await window.desktop.fileExists(image.path) })))
    const absentImages = imageChecks.filter((item) => !item.exists).map((item) => item.image.path)
    useProject.getState().hydrate({ ...project, clips })
    if (missing.length > 0) {
      alert(t('app.mediaMissing', { list: missing.join('\n') }))
    }
    if (absentImages.length > 0) alert(`Missing background images:\n${absentImages.join('\n')}`)
    if (unsupportedImages.length > 0) alert(`Animated or unsupported background images were not loaded:\n${[...new Set(unsupportedImages)].join('\n')}`)
  }

  const openProject = async (): Promise<void> => {
    const file = await window.desktop.openProject()
    if (!file) return
    if (!(await confirmReplaceProject())) return
    try {
      await loadProjectData(JSON.parse(file.text))
    } catch {
      alert(t('app.projectParseFail'))
      return
    }
    // Remember only a project that parsed and loaded successfully. Persistence
    // failure must not turn an otherwise successful open into a parse error.
    await window.desktop.rememberProjectPath(file.path).catch(() => {})
  }

  // 原生菜单与工具条共用同一份命令，保证两处行为完全一致
  const commands: AppCommands = {
    importLrc: () => void importLrc(),
    importVideo: () => void importVideo(),
    importAudio: () => void importAudio(),
    importPlugin: () => void importPlugin(),
    openProject: () => void openProject(),
    saveProject: () => void saveProject(),
    exportSrt: () => void exportSrt(),
    exportVideo: () => setShowExport(true)
  }
  // 命令每次渲染都是新对象；用 ref 兜住最新的一份，菜单监听只挂一次
  const commandsRef = useRef(commands)
  commandsRef.current = commands

  useEffect(
    () =>
      window.desktop.onMenuCommand((cmd) => {
        if (cmd === 'toggleConsole') setShowConsole((v) => !v)
        else if (cmd === 'undo' || cmd === 'redo' || cmd === 'selectAll') {
          const editable = activeEditorTarget()
          if (editable) {
            if (cmd === 'selectAll' && (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement)) editable.select()
            else document.execCommand(cmd)
          } else if (cmd === 'undo') useProject.getState().undo()
          else if (cmd === 'redo') useProject.getState().redo()
          else useProject.getState().selectAllCaptions()
        }
        else commandsRef.current[cmd]()
      }),
    []
  )

  useEffect(() => window.desktop.onMenuTogglePanel((id) => useWindows.getState().toggle(id)), [])

  // 勾选/置灰跟着界面走：这些一变就把整份菜单状态推给主进程重建原生菜单。
  // 文案在这边解析（渲染进程才有用户装的语言包），所以语言一换也要重推。
  useEffect(() => {
    window.desktop.setMenuState({
      labels: {
        openProject: t('topbar.openProject'),
        saveProject: t('topbar.saveProject'),
        importLrc: t('topbar.importLyrics'),
        importVideo: t('topbar.importVideo'),
        importAudio: t('topbar.importAudio'),
        importPlugin: t('topbar.importPlugin'),
        exportSrt: t('topbar.exportSrt'),
        exportVideo: t('topbar.exportVideo'),
        toggleConsole: t('console.title'),
        panels: t('menu.panels'),
        undo: locale === 'zh' ? '撤销' : 'Undo',
        redo: locale === 'zh' ? '重做' : 'Redo',
        selectAll: locale === 'zh' ? '全选' : 'Select All'
      },
      panels: WINDOW_REGISTRY.map((w) => ({
        id: w.id,
        label: t(w.labelKey as Parameters<typeof t>[0]),
        visible: !hiddenPanels[w.id]
      })),
      consoleOpen: showConsole,
      hasProject: canSave,
      hasCaptions,
      canExport
    })
    // t 每次渲染都是新函数，改依赖 locale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, hiddenPanels, showConsole, canSave, hasCaptions, canExport])

  useEffect(() => window.desktop.onCloseRequested(() => {
    void (async () => {
      if (!(await confirmReplaceProject())) return
      await window.desktop.confirmClose()
    })()
  }), [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <Logo />
          <h1>{t('topbar.title')}</h1>
        </span>
        <Toolbar
          commands={commands}
          hasProject={canSave}
          hasCaptions={hasCaptions}
          canExport={canExport}
          consoleOpen={showConsole}
          toggleConsole={() => setShowConsole((v) => !v)}
        />
        <div className="spacer" />
        <LanguageMenu />
      </header>

      <main className="layout">
        <aside className="panel panel-left">
          <TrackList />
          <ResourceLibrary />
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

      <CommandConsole open={showConsole} />

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
