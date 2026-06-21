import { useEffect, useState } from 'react'
import { useProject, RESOLUTIONS, type AspectId } from '../store/project'
import { EFFECTS } from '../core/effects'
import { SYSTEM_FONTS, loadBuiltinFonts, registerImportedFont, type FontOption } from '../fonts'
import { invalidateLayoutCache } from '../core/render'

/** 内联 style 用的 font-family（含空格/中文名加引号） */
const cssFamily = (family: string): string => `"${family}"`

/** 可折叠区块：标题点击展开/收起，收起时显示摘要 */
function Section({
  title,
  summary,
  defaultOpen = true,
  children
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="sp-section">
      <h3 className="sp-head" onClick={() => setOpen((o) => !o)}>
        <span className={`sp-caret${open ? ' open' : ''}`}>▸</span>
        {title}
        {!open && summary && <span className="sp-summary">{summary}</span>}
      </h3>
      {open && <div className="sp-body">{children}</div>}
    </section>
  )
}

/** 字体可视化选择：点击展开，每个字体用它自身渲染出字体名预览 */
function FontPicker({
  fonts,
  value,
  onPick,
  onImport
}: {
  fonts: FontOption[]
  value: string
  onPick: (family: string) => void
  onImport: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = fonts.find((f) => f.family === value)
  return (
    <div className="font-picker">
      <button className="font-current" onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: cssFamily(value) }}>{current?.label ?? value}</span>
        <span className="font-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="font-grid">
          {fonts.map((f) => (
            <button
              key={f.family}
              className={`font-cell${f.family === value ? ' active' : ''}`}
              style={{ fontFamily: cssFamily(f.family) }}
              title={f.label}
              onClick={() => {
                onPick(f.family)
                setOpen(false)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <button className="btn btn-sm" onClick={onImport}>
        导入字体文件…
      </button>
    </div>
  )
}

export function StylePanel(): React.JSX.Element {
  const style = useProject((s) => s.style)
  const patchStyle = useProject((s) => s.patchStyle)
  const selectedIds = useProject((s) => s.selectedIds)
  const lines = useProject((s) => s.lines)
  const pluginEffects = useProject((s) => s.pluginEffects)
  const [fonts, setFonts] = useState<FontOption[]>(SYSTEM_FONTS)

  // 内置 + 插件特效合并展示（插件项带标记）
  const effectChips = [
    ...EFFECTS.map((e) => ({ id: e.id, name: e.name, plugin: false })),
    ...pluginEffects.map((e) => ({ id: e.id, name: e.name, plugin: true }))
  ]

  const selectedEffects = new Set(
    lines.filter((l) => selectedIds.includes(l.id)).map((l) => l.effectId ?? style.effectId)
  )
  const activeEffectId =
    selectedIds.length === 0
      ? style.effectId
      : selectedEffects.size === 1
        ? [...selectedEffects][0]
        : null

  const chooseEffect = (id: string): void => {
    if (selectedIds.length > 0) useProject.getState().setLineEffect(selectedIds, id)
    else patchStyle({ effectId: id })
  }

  useEffect(() => {
    void loadBuiltinFonts().then((builtin) => {
      if (builtin.length > 0) {
        setFonts((prev) => [...builtin, ...prev])
        invalidateLayoutCache()
      }
    })
  }, [])

  const importFont = async (): Promise<void> => {
    const file = await window.desktop.openFont()
    if (!file) return
    try {
      const opt = await registerImportedFont(file.name, file.data)
      setFonts((prev) => [opt, ...prev.filter((f) => f.family !== opt.family)])
      patchStyle({ fontFamily: opt.family })
    } catch {
      alert('字体加载失败，请确认文件是有效的 ttf/otf 字体')
    }
  }

  const chooseBgImage = async (): Promise<void> => {
    const file = await window.desktop.openImage()
    if (file) patchStyle({ bgType: 'image', bgImage: file.path })
  }

  const bgName = style.bgImage ? style.bgImage.split(/[\\/]/).pop() : null
  const bgSummary =
    style.bgType === 'image' ? `图片：${bgName ?? '未选'}` : style.bgType === 'gradient' ? '渐变' : '纯色'

  return (
    <div className="style-panel">
      <Section title="画面尺寸">
        <label>
          <select value={style.aspect} onChange={(e) => patchStyle({ aspect: e.target.value as AspectId })}>
            {(Object.keys(RESOLUTIONS) as AspectId[]).map((id) => (
              <option key={id} value={id}>
                {RESOLUTIONS[id].label}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="背景" summary={bgSummary} defaultOpen={false}>
        <div className="bg-types">
          {(['image', 'gradient', 'solid'] as const).map((t) => (
            <button
              key={t}
              className={`effect-chip${style.bgType === t ? ' active' : ''}`}
              onClick={() => patchStyle({ bgType: t })}
            >
              {t === 'image' ? '图片' : t === 'gradient' ? '渐变' : '纯色'}
            </button>
          ))}
        </div>

        {style.bgType === 'image' && (
          <div className="bg-image">
            <button className="btn btn-primary btn-sm" onClick={() => void chooseBgImage()}>
              {style.bgImage ? '更换图片…' : '选择图片…'}
            </button>
            {bgName && <div className="bg-image-name">{bgName}</div>}
            <p className="hint">图片按 cover 铺满画面（保持比例裁切）</p>
          </div>
        )}

        {style.bgType === 'solid' && (
          <label className="row">
            颜色
            <input type="color" value={style.bgFrom} onChange={(e) => patchStyle({ bgFrom: e.target.value })} />
          </label>
        )}

        {style.bgType === 'gradient' && (
          <>
            <label className="row">
              渐变起点
              <input type="color" value={style.bgFrom} onChange={(e) => patchStyle({ bgFrom: e.target.value })} />
            </label>
            <label className="row">
              渐变终点
              <input type="color" value={style.bgTo} onChange={(e) => patchStyle({ bgTo: e.target.value })} />
            </label>
            <label>
              角度 {style.bgAngle}°
              <input
                type="range"
                min={0}
                max={360}
                value={style.bgAngle}
                onChange={(e) => patchStyle({ bgAngle: Number(e.target.value) })}
              />
            </label>
          </>
        )}
      </Section>

      <Section title="文字">
        <FontPicker
          fonts={fonts}
          value={style.fontFamily}
          onPick={(family) => patchStyle({ fontFamily: family })}
          onImport={importFont}
        />
        <label>
          字号 {style.fontSize}px
          <input
            type="range"
            min={40}
            max={180}
            value={style.fontSize}
            onChange={(e) => patchStyle({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          粗体
          <input
            type="checkbox"
            checked={style.fontWeight >= 600}
            onChange={(e) => patchStyle({ fontWeight: e.target.checked ? 700 : 400 })}
          />
        </label>
        <label className="row">
          斜体
          <input type="checkbox" checked={style.italic} onChange={(e) => patchStyle({ italic: e.target.checked })} />
        </label>
        <label className="row">
          文字颜色
          <input type="color" value={style.textColor} onChange={(e) => patchStyle({ textColor: e.target.value })} />
        </label>
        <label>
          文字不透明度 {Math.round(style.textAlpha * 100)}%
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(style.textAlpha * 100)}
            onChange={(e) => patchStyle({ textAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="row">
          片头显示歌名
          <input type="checkbox" checked={style.showMeta} onChange={(e) => patchStyle({ showMeta: e.target.checked })} />
        </label>
      </Section>

      <Section title="文字整体变换" summary={`X${style.globalDx} Y${style.globalDy} ${style.globalRotate}°`} defaultOpen={false}>
        <p className="hint">所有文字（歌词与文字块）一起平移、旋转</p>
        <label>
          水平 X {style.globalDx}px
          <input
            type="range"
            min={-800}
            max={800}
            value={style.globalDx}
            onChange={(e) => patchStyle({ globalDx: Number(e.target.value) })}
          />
        </label>
        <label>
          垂直 Y {style.globalDy}px
          <input
            type="range"
            min={-800}
            max={800}
            value={style.globalDy}
            onChange={(e) => patchStyle({ globalDy: Number(e.target.value) })}
          />
        </label>
        <label>
          旋转 {style.globalRotate}°
          <input
            type="range"
            min={-180}
            max={180}
            value={style.globalRotate}
            onChange={(e) => patchStyle({ globalRotate: Number(e.target.value) })}
          />
        </label>
        <button
          className="btn btn-sm"
          onClick={() => patchStyle({ globalDx: 0, globalDy: 0, globalRotate: 0 })}
        >
          重置
        </button>
      </Section>

      <Section title="字幕底色与描影" defaultOpen={false}>
        <label>
          底色不透明度 {Math.round(style.textBgAlpha * 100)}%{style.textBgAlpha === 0 ? '（无底色）' : ''}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(style.textBgAlpha * 100)}
            onChange={(e) => patchStyle({ textBgAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        {style.textBgAlpha > 0 && (
          <label className="row">
            底色颜色
            <input type="color" value={style.textBgColor} onChange={(e) => patchStyle({ textBgColor: e.target.value })} />
          </label>
        )}
        <label>
          光晕强度 {style.halo}px{style.halo === 0 ? '（关）' : ''}
          <input
            type="range"
            min={0}
            max={40}
            value={style.halo}
            onChange={(e) => patchStyle({ halo: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          光晕/辉光颜色
          <input type="color" value={style.glowColor} onChange={(e) => patchStyle({ glowColor: e.target.value })} />
        </label>
        <label>
          阴影不透明度 {Math.round(style.shadowAlpha * 100)}%{style.shadowAlpha === 0 ? '（关）' : ''}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(style.shadowAlpha * 100)}
            onChange={(e) => patchStyle({ shadowAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        {style.shadowAlpha > 0 && (
          <>
            <label className="row">
              阴影颜色
              <input type="color" value={style.shadowColor} onChange={(e) => patchStyle({ shadowColor: e.target.value })} />
            </label>
            <label>
              阴影偏移 {style.shadowOffset}px
              <input
                type="range"
                min={0}
                max={20}
                value={style.shadowOffset}
                onChange={(e) => patchStyle({ shadowOffset: Number(e.target.value) })}
              />
            </label>
            <label>
              阴影模糊 {style.shadowBlur}px
              <input
                type="range"
                min={0}
                max={30}
                value={style.shadowBlur}
                onChange={(e) => patchStyle({ shadowBlur: Number(e.target.value) })}
              />
            </label>
          </>
        )}
      </Section>

      <Section title={`特效${selectedIds.length > 0 ? `（选中 ${selectedIds.length} 条）` : '（全局默认）'}`}>
        <div className="effect-list">
          {effectChips.map((fx) => (
            <button
              key={fx.id}
              className={`effect-chip${activeEffectId === fx.id ? ' active' : ''}${fx.plugin ? ' plugin' : ''}`}
              onClick={() => chooseEffect(fx.id)}
              title={fx.plugin ? '插件特效' : undefined}
            >
              {fx.name}
              {fx.plugin && <span className="effect-chip-tag">插件</span>}
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <button className="btn btn-sm" onClick={() => useProject.getState().setLineEffect(selectedIds, null)}>
            恢复跟随全局默认
          </button>
        )}
        <label className="row">
          卡拉OK高亮色
          <input
            type="color"
            value={style.highlightColor}
            onChange={(e) => patchStyle({ highlightColor: e.target.value })}
          />
        </label>
        <label>
          强度 {style.intensity.toFixed(1)}
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.1}
            value={style.intensity}
            onChange={(e) => patchStyle({ intensity: Number(e.target.value) })}
          />
        </label>
      </Section>
    </div>
  )
}
