import { useProject, allCaptionTracks } from '../store/project'
import { usePanels } from '../store/panels'
import { CaptionTrackPanel } from './CaptionTrackPanel'
import { FloatingPanelFrame } from './FloatingPanelFrame'
import { ClosableSection } from './ClosableSection'
import { useT } from '../i18n'

/**
 * 左侧栏：全部字幕组一览（主字幕组 + 多语言额外字幕组），整块可折叠/关闭
 * （windowId="captions"，在顶栏「窗口」菜单里恢复）。
 * 每组一行：可见性、展开/收起、浮动/停靠、删除；展开时在下方（停靠）或另开浮动窗口显示
 * 该组的 CaptionTrackPanel（歌词列表/导入/位置等）。「+ 新增字幕组」新增一组并默认浮动展开。
 * 浮动窗独立于本区块是否折叠/关闭——已经飘出去的窗口不会因为收起列表而跟着消失。
 */
export function TrackList(): React.JSX.Element {
  const t = useT()
  const meta = useProject((s) => s.meta)
  const lrcName = useProject((s) => s.lrcName)
  const tracksArr = useProject((s) => s.tracks)
  const lines = useProject((s) => s.lines)
  const panels = usePanels((s) => s.panels)

  const tracks = allCaptionTracks({ meta, lrcName, tracks: tracksArr })

  const lineCount = (id: number): number =>
    lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === id).length

  const addTrack = (): void => {
    const tr = useProject.getState().addTrack()
    usePanels.getState().openPanel(tr.id, true)
  }

  return (
    <>
      <ClosableSection windowId="captions" title={t('tracks.sectionTitle')}>
        <button className="btn btn-sm" onClick={addTrack}>
          {t('tracks.addTrack')}
        </button>

        {tracks.map((track) => {
          const panel = panels[track.id]
          const isOpen = panel?.open ?? false
          const isFloating = panel?.floating ?? track.id !== 0
          const displayName = track.name || t(track.id === 0 ? 'tracks.primary' : 'tracks.untitled', { n: track.id })

          return (
            <div key={track.id}>
              <div className="track-row">
                <span className="track-row-name" title={displayName}>
                  {displayName}
                </span>
                <span className="track-row-meta">{t('tracks.lineCount', { n: lineCount(track.id) })}</span>
                {track.id !== 0 && (
                  <button
                    className="track-row-btn"
                    title={track.visible ? t('tracks.hideTrack') : t('tracks.showTrack')}
                    onClick={() => useProject.getState().setTrackVisible(track.id, !track.visible)}
                  >
                    {track.visible ? '◉' : '○'}
                  </button>
                )}
                <button
                  className={`track-row-btn${isOpen ? ' active' : ''}`}
                  title={t('tracks.openPanel')}
                  onClick={() => (isOpen ? usePanels.getState().closePanel(track.id) : usePanels.getState().openPanel(track.id))}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                {isOpen && (
                  <button
                    className="track-row-btn wide"
                    onClick={() => usePanels.getState().setFloating(track.id, !isFloating)}
                  >
                    {isFloating ? t('tracks.dock') : t('tracks.float')}
                  </button>
                )}
                {track.id !== 0 && (
                  <button
                    className="track-row-btn"
                    title={t('tracks.deleteTrack')}
                    onClick={() => {
                      useProject.getState().removeTrack(track.id)
                      usePanels.getState().closePanel(track.id)
                    }}
                  >
                    🗑
                  </button>
                )}
              </div>
              {isOpen && !isFloating && (
                <div className="track-panel-dock">
                  <CaptionTrackPanel trackId={track.id} />
                </div>
              )}
            </div>
          )
        })}
      </ClosableSection>

      {tracks.map((track) => {
        const panel = panels[track.id]
        if (!panel?.open || !panel.floating) return null
        const displayName = track.name || t(track.id === 0 ? 'tracks.primary' : 'tracks.untitled', { n: track.id })
        return (
          <FloatingPanelFrame key={track.id} panelId={track.id} title={displayName}>
            <CaptionTrackPanel trackId={track.id} />
          </FloatingPanelFrame>
        )
      })}
    </>
  )
}
