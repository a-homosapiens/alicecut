import { useEffect, useState } from 'react'
import { useProject, RESOLUTIONS, type AspectId } from '../store/project'
import { EFFECTS } from '../core/effects'
import { SYSTEM_FONTS, loadBuiltinFonts, registerImportedFont, type FontOption } from '../fonts'
import { invalidateLayoutCache } from '../core/render'
import { useT, hasMsg } from '../i18n'

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
  const t = useT()
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
        {t('style.importFont')}
      </button>
    </div>
  )
}

export function StylePanel(): React.JSX.Element {
  const t = useT()
  const style = useProject((s) => s.style)
  const patchStyle = useProject((s) => s.patchStyle)
  const selectedIds = useProject((s) => s.selectedIds)
  const lines = useProject((s) => s.lines)
  const pluginEffects = useProject((s) => s.pluginEffects)
  const [fonts, setFonts] = useState<FontOption[]>(SYSTEM_FONTS)

  // 内置特效名按语言翻译（有 effect.<id> 键）；插件特效无键，回退自带 name
  const effectLabel = (id: string, name: string): string =>
    hasMsg(`effect.${id}`) ? t(`effect.${id}` as Parameters<typeof t>[0]) : name

  // 内置 + 插件特效合并展示（插件项带标记）
  const effectChips = [
    ...EFFECTS.map((e) => ({ id: e.id, name: effectLabel(e.id, e.name), plugin: false })),
    ...pluginEffects.map((e) => ({ id: e.id, name: effectLabel(e.id, e.name), plugin: true }))
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
      alert(t('style.fontLoadFail'))
    }
  }

  const chooseBgImage = async (): Promise<void> => {
    const file = await window.desktop.openImage()
    if (file) patchStyle({ bgType: 'image', bgImage: file.path })
  }

  const bgName = style.bgImage ? style.bgImage.split(/[\\/]/).pop() : null
  const bgSummary =
    style.bgType === 'image'
      ? t('style.bgSummaryImage', { name: bgName ?? t('style.bgNone') })
      : style.bgType === 'gradient'
        ? t('style.bgGradient')
        : t('style.bgSolid')

  return (
    <div className="style-panel">
      <Section title={t('style.sizeSection')}>
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

      <Section title={t('style.bgSection')} summary={bgSummary} defaultOpen={false}>
        <div className="bg-types">
          {(['image', 'gradient', 'solid'] as const).map((bt) => (
            <button
              key={bt}
              className={`effect-chip${style.bgType === bt ? ' active' : ''}`}
              onClick={() => patchStyle({ bgType: bt })}
            >
              {bt === 'image' ? t('style.bgImage') : bt === 'gradient' ? t('style.bgGradient') : t('style.bgSolid')}
            </button>
          ))}
        </div>

        {style.bgType === 'image' && (
          <div className="bg-image">
            <button className="btn btn-primary btn-sm" onClick={() => void chooseBgImage()}>
              {style.bgImage ? t('style.changeImage') : t('style.chooseImage')}
            </button>
            {bgName && <div className="bg-image-name">{bgName}</div>}
            <p className="hint">{t('style.bgImageHint')}</p>
          </div>
        )}

        {style.bgType === 'solid' && (
          <label className="row">
            {t('style.color')}
            <input type="color" value={style.bgFrom} onChange={(e) => patchStyle({ bgFrom: e.target.value })} />
          </label>
        )}

        {style.bgType === 'gradient' && (
          <>
            <label className="row">
              {t('style.gradFrom')}
              <input type="color" value={style.bgFrom} onChange={(e) => patchStyle({ bgFrom: e.target.value })} />
            </label>
            <label className="row">
              {t('style.gradTo')}
              <input type="color" value={style.bgTo} onChange={(e) => patchStyle({ bgTo: e.target.value })} />
            </label>
            <label>
              {t('style.angle')} {style.bgAngle}°
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

      <Section title={t('style.textSection')}>
        <FontPicker
          fonts={fonts}
          value={style.fontFamily}
          onPick={(family) => patchStyle({ fontFamily: family })}
          onImport={importFont}
        />
        <label>
          {t('style.fontSize')} {style.fontSize}px
          <input
            type="range"
            min={40}
            max={180}
            value={style.fontSize}
            onChange={(e) => patchStyle({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          {t('style.bold')}
          <input
            type="checkbox"
            checked={style.fontWeight >= 600}
            onChange={(e) => patchStyle({ fontWeight: e.target.checked ? 700 : 400 })}
          />
        </label>
        <label className="row">
          {t('style.italic')}
          <input type="checkbox" checked={style.italic} onChange={(e) => patchStyle({ italic: e.target.checked })} />
        </label>
        <label className="row">
          {t('style.textColor')}
          <input type="color" value={style.textColor} onChange={(e) => patchStyle({ textColor: e.target.value })} />
        </label>
        <label>
          {t('style.textAlpha')} {Math.round(style.textAlpha * 100)}%
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(style.textAlpha * 100)}
            onChange={(e) => patchStyle({ textAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="row">
          {t('style.showMeta')}
          <input type="checkbox" checked={style.showMeta} onChange={(e) => patchStyle({ showMeta: e.target.checked })} />
        </label>
      </Section>

      <Section title={t('style.transformSection')} summary={`X${style.globalDx} Y${style.globalDy} ${style.globalRotate}°`} defaultOpen={false}>
        <p className="hint">{t('style.transformHint')}</p>
        <label>
          {t('style.transformX')} {style.globalDx}px
          <input
            type="range"
            min={-800}
            max={800}
            value={style.globalDx}
            onChange={(e) => patchStyle({ globalDx: Number(e.target.value) })}
          />
        </label>
        <label>
          {t('style.transformY')} {style.globalDy}px
          <input
            type="range"
            min={-800}
            max={800}
            value={style.globalDy}
            onChange={(e) => patchStyle({ globalDy: Number(e.target.value) })}
          />
        </label>
        <label>
          {t('style.rotate')} {style.globalRotate}°
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
          {t('style.reset')}
        </button>
      </Section>

      <Section title={t('style.decorSection')} defaultOpen={false}>
        <label>
          {t('style.bgBoxAlpha')} {Math.round(style.textBgAlpha * 100)}%{style.textBgAlpha === 0 ? t('style.noBgBox') : ''}
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
            {t('style.bgBoxColor')}
            <input type="color" value={style.textBgColor} onChange={(e) => patchStyle({ textBgColor: e.target.value })} />
          </label>
        )}
        <label>
          {t('style.halo')} {style.halo}px{style.halo === 0 ? t('style.off') : ''}
          <input
            type="range"
            min={0}
            max={40}
            value={style.halo}
            onChange={(e) => patchStyle({ halo: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          {t('style.glowColor')}
          <input type="color" value={style.glowColor} onChange={(e) => patchStyle({ glowColor: e.target.value })} />
        </label>
        <label>
          {t('style.shadowAlpha')} {Math.round(style.shadowAlpha * 100)}%{style.shadowAlpha === 0 ? t('style.off') : ''}
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
              {t('style.shadowColor')}
              <input type="color" value={style.shadowColor} onChange={(e) => patchStyle({ shadowColor: e.target.value })} />
            </label>
            <label>
              {t('style.shadowOffset')} {style.shadowOffset}px
              <input
                type="range"
                min={0}
                max={20}
                value={style.shadowOffset}
                onChange={(e) => patchStyle({ shadowOffset: Number(e.target.value) })}
              />
            </label>
            <label>
              {t('style.shadowBlur')} {style.shadowBlur}px
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

      <Section
        title={`${t('style.effects')}${
          selectedIds.length > 0 ? t('style.effectsSelected', { n: selectedIds.length }) : t('style.effectsGlobal')
        }`}
      >
        <div className="effect-list">
          {effectChips.map((fx) => (
            <button
              key={fx.id}
              className={`effect-chip${activeEffectId === fx.id ? ' active' : ''}${fx.plugin ? ' plugin' : ''}`}
              onClick={() => chooseEffect(fx.id)}
              title={fx.plugin ? t('style.pluginEffectTitle') : undefined}
            >
              {fx.name}
              {fx.plugin && <span className="effect-chip-tag">{t('style.pluginTag')}</span>}
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <button className="btn btn-sm" onClick={() => useProject.getState().setLineEffect(selectedIds, null)}>
            {t('style.restoreDefault')}
          </button>
        )}
        <label className="row">
          {t('style.highlightColor')}
          <input
            type="color"
            value={style.highlightColor}
            onChange={(e) => patchStyle({ highlightColor: e.target.value })}
          />
        </label>
        <label>
          {t('style.intensity')} {style.intensity.toFixed(1)}
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
