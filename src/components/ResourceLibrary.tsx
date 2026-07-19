import { useProject, allCaptionTracks } from '../store/project'
import { usePanels } from '../store/panels'
import { seek } from '../playback'
import { mediaUrl } from '../mediaPool'
import { ClosableSection } from './ClosableSection'
import { useT } from '../i18n'

function fmt(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 资源库：已导入视频/音频/字幕组/图片一览——主要是浏览+管理，不是新的导入入口
 * （视频/音频导入仍走顶栏，避免在这里重复 App.tsx 的分层落位逻辑）。
 * 默认停靠在左侧栏（字幕组下方），整块可折叠/关闭（windowId="resourceLibrary"，
 * 在顶栏「窗口」菜单里恢复）。
 */
export function ResourceLibrary(): React.JSX.Element {
  const t = useT()
  const clips = useProject((s) => s.clips)
  const lines = useProject((s) => s.lines)
  const meta = useProject((s) => s.meta)
  const lrcName = useProject((s) => s.lrcName)
  const tracksArr = useProject((s) => s.tracks)
  const images = useProject((s) => s.images)
  const bgImage = useProject((s) => s.style.bgImage)

  const videos = clips.filter((c) => c.kind === 'video')
  const audios = clips.filter((c) => c.kind === 'audio')
  const tracks = allCaptionTracks({ meta, lrcName, tracks: tracksArr })
  const lineCount = (trackId: number): number =>
    lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === trackId).length

  const selectClip = (id: number, startMs: number): void => {
    useProject.getState().setSelectedClip(id)
    seek(startMs / 1000)
  }

  const importImage = async (): Promise<void> => {
    const file = await window.desktop.openImage()
    if (!file) return
    useProject.getState().addImage(file.path, file.name)
  }

  const clipSection = (title: string, list: typeof clips): React.JSX.Element => (
    <section className="resource-section">
      <h3>{title}</h3>
      {list.length === 0 ? (
        <p className="hint">{t('resourceLibrary.empty')}</p>
      ) : (
        list.map((c) => (
          <div key={c.id} className="resource-row" onClick={() => selectClip(c.id, c.start)}>
            <span className="resource-row-name" title={c.path}>
              {c.name}
            </span>
            <span className="resource-row-meta">{fmt(c.start)}</span>
            <button
              className="track-row-btn"
              title={t('resourceLibrary.remove')}
              onClick={(e) => {
                e.stopPropagation()
                useProject.getState().removeClip(c.id)
              }}
            >
              🗑
            </button>
          </div>
        ))
      )}
    </section>
  )

  return (
    <ClosableSection windowId="resourceLibrary" title={t('resourceLibrary.title')}>
      {clipSection(t('resourceLibrary.videosSection'), videos)}
      {clipSection(t('resourceLibrary.audiosSection'), audios)}

      <section className="resource-section">
        <h3>{t('resourceLibrary.captionsSection')}</h3>
        {tracks.map((track) => {
          const displayName = track.name || t(track.id === 0 ? 'tracks.primary' : 'tracks.untitled', { n: track.id })
          return (
            <div key={track.id} className="resource-row" onClick={() => usePanels.getState().openPanel(track.id)}>
              <span className="resource-row-name">{displayName}</span>
              <span className="resource-row-meta">{t('tracks.lineCount', { n: lineCount(track.id) })}</span>
              {track.id !== 0 && (
                <button
                  className="track-row-btn"
                  title={t('resourceLibrary.remove')}
                  onClick={(e) => {
                    e.stopPropagation()
                    useProject.getState().removeTrack(track.id)
                  }}
                >
                  🗑
                </button>
              )}
            </div>
          )
        })}
      </section>

      <section className="resource-section">
        <h3>{t('resourceLibrary.imagesSection')}</h3>
        {images.length === 0 ? (
          <p className="hint">{t('resourceLibrary.empty')}</p>
        ) : (
          images.map((img) => (
            <div
              key={img.id}
              className={`resource-row resource-row-image${img.path === bgImage ? ' active' : ''}`}
              onClick={() => useProject.getState().patchStyle({ bgType: 'image', bgImage: img.path })}
              title={img.path === bgImage ? t('resourceLibrary.activeImage') : img.path}
            >
              <img className="resource-thumb" src={mediaUrl(img.path)} alt={img.name} />
              <span className="resource-row-name">{img.name}</span>
              <button
                className="track-row-btn"
                title={t('resourceLibrary.remove')}
                onClick={(e) => {
                  e.stopPropagation()
                  useProject.getState().removeImage(img.id)
                }}
              >
                🗑
              </button>
            </div>
          ))
        )}
        <button className="btn btn-sm" onClick={() => void importImage()}>
          {t('resourceLibrary.importImage')}
        </button>
      </section>
    </ClosableSection>
  )
}
