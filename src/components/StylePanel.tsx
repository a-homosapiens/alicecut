import { useEffect, useState } from 'react'
import { useProject, RESOLUTIONS, type AspectId } from '../store/project'
import { EFFECTS } from '../core/effects'
import {
  BUILTIN_FONT_OPTIONS,
  SYSTEM_FONTS,
  installBuiltinFont,
  registerImportedFont,
  restoreImportedFonts,
  restoreInstalledFonts,
  type FontOption
} from '../fonts'
import { invalidateLayoutCache } from '../core/render'
import { loadBgImage } from '../mediaPool'
import type { LineTextOverride } from '../core/types'
import { ClosableSection } from './ClosableSection'
import { useT, hasMsg } from '../i18n'
import { fontSizeToSliderPosition, sliderPositionToFontSize } from '../core/previewTransform'

/** 内联 style 用的 font-family（含空格/中文名加引号） */
const cssFamily = (family: string): string => `"${family}"`

/**
 * 选中单句字幕/文字块时，右栏顶部的文字内容编辑框。随输入即时更新预览
 * （updateLineText 按新文字重插值逐字时间）。用 line.id 作 key 重挂，
 * 切换选中行时自动载入该行文字。
 */
function LineContentEditor({ line }: { line: { id: number; text: string } }): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(line.text)
  return (
    <div className="style-content-edit">
      <span className="style-content-title">{t('style.contentSection')}</span>
      <input
        className="text-edit-input"
        value={draft}
        placeholder={t('style.contentPlaceholder')}
        onChange={(e) => {
          setDraft(e.target.value)
          useProject.getState().updateLineText(line.id, e.target.value)
        }}
      />
      <p className="hint">{t('style.contentHint')}</p>
    </div>
  )
}

/** 字体可视化选择：点击展开，每个字体用它自身渲染出字体名预览 */
function FontPicker({
  fonts,
  value,
  onPick,
  onImport,
  installed,
  loadingFamily
}: {
  fonts: FontOption[]
  value: string
  onPick: (font: FontOption) => Promise<void>
  onImport: () => void
  installed: ReadonlySet<string>
  loadingFamily: string | null
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
              className={`font-cell${f.family === value ? ' active' : ''}${f.builtin && !installed.has(f.family) ? ' downloadable' : ''}`}
              title={f.label}
              disabled={loadingFamily !== null}
              onClick={() => {
                void onPick(f).then(() => setOpen(false))
              }}
            >
              {f.previewUrl && !installed.has(f.family) ? (
                <img className="font-preview" src={f.previewUrl} alt={f.label} />
              ) : (
                <span className="font-preview-text" style={{ fontFamily: cssFamily(f.family) }}>{f.label}</span>
              )}
              {f.builtin && !installed.has(f.family) && (
                <span className={`font-download-badge${loadingFamily === f.family ? ' loading' : ''}`} aria-label={t('style.fontDownload')}>
                  {loadingFamily === f.family ? '…' : '⇩'}
                </span>
              )}
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
  const setGlobalEffectDuration = useProject((s) => s.setGlobalEffectDuration)
  const selectedIds = useProject((s) => s.selectedIds)
  const lines = useProject((s) => s.lines)
  const pluginEffects = useProject((s) => s.pluginEffects)
  const [fonts, setFonts] = useState<FontOption[]>([...BUILTIN_FONT_OPTIONS, ...SYSTEM_FONTS])
  const [installedFonts, setInstalledFonts] = useState<Set<string>>(
    () => new Set([
      ...SYSTEM_FONTS.map((font) => font.family),
      ...BUILTIN_FONT_OPTIONS.filter((font) => font.bundled).map((font) => font.family)
    ])
  )
  const [loadingFont, setLoadingFont] = useState<string | null>(null)

  // 内置特效名按语言翻译（有 effect.<id> 键）；插件特效无键，回退自带 name
  const effectLabel = (id: string, name: string): string =>
    hasMsg(`effect.${id}`) ? t(`effect.${id}` as Parameters<typeof t>[0]) : name

  // 内置 + 插件特效合并展示（插件项带标记）
  const effectChips = [
    ...EFFECTS.map((e) => ({
      id: e.id,
      name: effectLabel(e.id, e.name),
      plugin: false,
      picker: e.picker ?? ('both' as const)
    })),
    ...pluginEffects.map((e) => ({
      id: e.id,
      name: effectLabel(e.id, e.name),
      plugin: true,
      picker: 'both' as const
    }))
  ]
  const inEffectChips = effectChips.filter((effect) => effect.picker !== 'out')
  const outEffectChips = effectChips.filter((effect) => effect.picker !== 'in')

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

  // 退场特效（仅对选中行，按行设置；'' = 默认淡出）
  const selectedOut = new Set(lines.filter((l) => selectedIds.includes(l.id)).map((l) => l.effectOutId ?? ''))
  const activeOutId = selectedOut.size === 1 ? [...selectedOut][0] : null
  const firstSelectedLine = lines.find((line) => selectedIds.includes(line.id))
  const inDurationMs = firstSelectedLine?.effectInDurationMs ?? style.effectInDurationMs
  const outDurationMs = firstSelectedLine?.effectOutDurationMs ?? style.effectOutDurationMs
  const setEffectDuration = (which: 'in' | 'out', seconds: number): void => {
    const durationMs = Math.max(0, Math.round(seconds * 1000))
    if (selectedIds.length > 0) useProject.getState().setLineEffectDuration(selectedIds, which, durationMs)
    else setGlobalEffectDuration(which, durationMs)
  }

  // 文字属性：有选中行则改这些行的覆盖，否则改全局；显示值取首个选中行的有效值
  const textSel = selectedIds.length > 0
  const ov = textSel ? lines.find((l) => selectedIds.includes(l.id))?.over : undefined
  const effFamily = ov?.fontFamily ?? style.fontFamily
  const effSize = ov?.fontSize ?? style.fontSize
  const effLineRotate = ov?.rotate ?? 0
  const effWeight = ov?.fontWeight ?? style.fontWeight
  const effItalic = ov?.italic ?? style.italic
  const effColor = ov?.textColor ?? style.textColor
  const effAlpha = ov?.textAlpha ?? style.textAlpha
  const effLetterSpacing = ov?.letterSpacing ?? style.letterSpacing
  const effWordSpacing = ov?.wordSpacing ?? style.wordSpacing
  const effLineSpacing = ov?.lineSpacing ?? style.lineSpacing
  const effTextAlign = ov?.textAlign ?? style.textAlign
  const effTextOrientation = ov?.textOrientation ?? style.textOrientation
  const effStrokeColor = ov?.strokeColor ?? style.strokeColor
  const effStrokeWidth = ov?.strokeWidth ?? style.strokeWidth
  const effStrokeAlpha = ov?.strokeAlpha ?? style.strokeAlpha
  const effTextBgColor = ov?.textBgColor ?? style.textBgColor
  const effTextBgAlpha = ov?.textBgAlpha ?? style.textBgAlpha
  const effHalo = ov?.halo ?? style.halo
  const effGlowColor = ov?.glowColor ?? style.glowColor
  const effShadowColor = ov?.shadowColor ?? style.shadowColor
  const effShadowAlpha = ov?.shadowAlpha ?? style.shadowAlpha
  const effShadowOffset = ov?.shadowOffset ?? style.shadowOffset
  const effShadowBlur = ov?.shadowBlur ?? style.shadowBlur
  const applyText = (patch: Partial<LineTextOverride>): void => {
    if (textSel) useProject.getState().patchLineOver(selectedIds, patch)
    else patchStyle(patch)
  }

  // 恰好选中一句时，顶部显示文字内容编辑框（多选/未选时不显示）
  const soleLine = selectedIds.length === 1 ? lines.find((l) => l.id === selectedIds[0]) : undefined

  useEffect(() => {
    void Promise.all([restoreInstalledFonts(), restoreImportedFonts()]).then(([restored, imported]) => {
      setInstalledFonts((previous) => new Set([...previous, ...restored, ...imported.map((font) => font.family)]))
      setFonts((previous) => [...imported, ...previous.filter((font) => !imported.some((item) => item.family === font.family))])
      if (restored.size > 0 || imported.length > 0) invalidateLayoutCache()
    })
  }, [])

  const pickFont = async (font: FontOption): Promise<void> => {
    try {
      if (font.builtin && !installedFonts.has(font.family)) {
        setLoadingFont(font.family)
        await installBuiltinFont(font.family)
        setInstalledFonts((previous) => new Set(previous).add(font.family))
        invalidateLayoutCache()
      }
      applyText({ fontFamily: font.family })
    } catch {
      alert(t('style.fontLoadFail'))
    } finally {
      setLoadingFont(null)
    }
  }

  const importFont = async (): Promise<void> => {
    const file = await window.desktop.openFont()
    if (!file) return
    try {
      const opt = await registerImportedFont(file.name, file.data)
      setFonts((prev) => [opt, ...prev.filter((f) => f.family !== opt.family)])
      setInstalledFonts((previous) => new Set(previous).add(opt.family))
      applyText({ fontFamily: opt.family })
    } catch {
      alert(t('style.fontLoadFail'))
    }
  }

  const chooseBgImage = async (): Promise<void> => {
    const file = await window.desktop.openImage()
    if (!file) return
    try {
      await loadBgImage(file.path)
      useProject.getState().addImage(file.path, file.name)
      patchStyle({ bgType: 'image', bgImage: file.path })
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
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
      {soleLine && <LineContentEditor key={soleLine.id} line={soleLine} />}

      <ClosableSection windowId="style.size" title={t('style.sizeSection')}>
        <label>
          <select value={style.aspect} onChange={(e) => patchStyle({ aspect: e.target.value as AspectId })}>
            {(Object.keys(RESOLUTIONS) as AspectId[]).map((id) => (
              <option key={id} value={id}>
                {RESOLUTIONS[id].label}
              </option>
            ))}
          </select>
        </label>
      </ClosableSection>

      <ClosableSection windowId="style.background" title={t('style.bgSection')} summary={bgSummary} defaultOpen={false}>
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
            {style.bgImage && (
              <>
                <label className="row">
                  {t('style.bgImageScale')}
                  <input
                    type="range"
                    min={0.2}
                    max={3}
                    step={0.01}
                    value={style.bgImageScale}
                    onChange={(e) => patchStyle({ bgImageScale: Number(e.target.value) })}
                  />
                  <span className="val">{style.bgImageScale.toFixed(2)}×</span>
                </label>
                <label className="row">
                  {t('style.bgImageX')}
                  <input
                    type="range"
                    min={-RESOLUTIONS[style.aspect].width / 2}
                    max={RESOLUTIONS[style.aspect].width / 2}
                    step={1}
                    value={style.bgImageX}
                    onChange={(e) => patchStyle({ bgImageX: Number(e.target.value) })}
                  />
                </label>
                <label className="row">
                  {t('style.bgImageY')}
                  <input
                    type="range"
                    min={-RESOLUTIONS[style.aspect].height / 2}
                    max={RESOLUTIONS[style.aspect].height / 2}
                    step={1}
                    value={style.bgImageY}
                    onChange={(e) => patchStyle({ bgImageY: Number(e.target.value) })}
                  />
                </label>
                <label>
                  {t('style.bgImageRotate')} {style.bgImageRotate}°
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={style.bgImageRotate}
                    onChange={(e) => patchStyle({ bgImageRotate: Number(e.target.value) })}
                  />
                </label>
                <button
                  className="btn btn-sm"
                  onClick={() => patchStyle({ bgImageScale: 1, bgImageX: 0, bgImageY: 0, bgImageRotate: 0 })}
                >
                  {t('style.bgImageReset')}
                </button>
              </>
            )}
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
      </ClosableSection>

      <ClosableSection
        windowId="style.text"
        title={`${t('style.textSection')}${
          textSel ? t('style.effectsSelected', { n: selectedIds.length }) : t('style.effectsGlobal')
        }`}
      >
        <FontPicker
          fonts={fonts}
          value={effFamily}
          onPick={pickFont}
          onImport={importFont}
          installed={installedFonts}
          loadingFamily={loadingFont}
        />
        <label>
          {t('style.fontSize')} {effSize}px
          <input
            type="range"
            min={0}
            max={1000}
            value={fontSizeToSliderPosition(effSize)}
            onChange={(e) => applyText({ fontSize: sliderPositionToFontSize(Number(e.target.value)) })}
          />
        </label>
        <label className="row">
          {t('style.bold')}
          <input
            type="checkbox"
            checked={effWeight >= 600}
            onChange={(e) => applyText({ fontWeight: e.target.checked ? 700 : 400 })}
          />
        </label>
        <label className="row">
          {t('style.italic')}
          <input type="checkbox" checked={effItalic} onChange={(e) => applyText({ italic: e.target.checked })} />
        </label>
        <label className="row">
          {t('style.textColor')}
          <input type="color" value={effColor} onChange={(e) => applyText({ textColor: e.target.value })} />
        </label>
        <label>
          {t('style.textAlpha')} {Math.round(effAlpha * 100)}%
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(effAlpha * 100)}
            onChange={(e) => applyText({ textAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        <label>
          {t('style.letterSpacing')} {effLetterSpacing}px
          <input
            type="range"
            min={-20}
            max={80}
            value={effLetterSpacing}
            onChange={(e) => applyText({ letterSpacing: Number(e.target.value) })}
          />
        </label>
        <label>
          {t('style.wordSpacing')} {effWordSpacing}px
          <input
            type="range"
            min={0}
            max={160}
            value={effWordSpacing}
            onChange={(e) => applyText({ wordSpacing: Number(e.target.value) })}
          />
        </label>
        <label>
          {t('style.lineSpacing')} {effLineSpacing.toFixed(2)}x
          <input
            type="range"
            min={0.7}
            max={2.2}
            step={0.05}
            value={effLineSpacing}
            onChange={(e) => applyText({ lineSpacing: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          {t('style.textAlign')}
          <select
            value={effTextAlign}
            onChange={(e) => applyText({ textAlign: e.target.value as 'left' | 'center' | 'right' })}
          >
            <option value="left">{t('style.alignLeft')}</option>
            <option value="center">{t('style.alignCenter')}</option>
            <option value="right">{t('style.alignRight')}</option>
          </select>
        </label>
        <label className="row">
          {t('style.textOrientation')}
          <select
            value={effTextOrientation}
            onChange={(e) => applyText({ textOrientation: e.target.value as 'horizontal' | 'vertical' })}
          >
            <option value="horizontal">{t('style.orientationHorizontal')}</option>
            <option value="vertical">{t('style.orientationVertical')}</option>
          </select>
        </label>
        {textSel && (
          <label>
            {t('style.lineRotate')} {effLineRotate}°
            <input
              type="range"
              min={-180}
              max={180}
              value={effLineRotate}
              onChange={(e) => applyText({ rotate: Number(e.target.value) })}
            />
          </label>
        )}
        <label>
          {t('style.strokeWidth')} {effStrokeWidth}px{effStrokeWidth === 0 ? t('style.off') : ''}
          <input
            type="range"
            min={0}
            max={24}
            step={1}
            value={effStrokeWidth}
            onChange={(e) => applyText({ strokeWidth: Number(e.target.value) })}
          />
        </label>
        {effStrokeWidth > 0 && (
          <>
            <label className="row">
              {t('style.strokeColor')}
              <input type="color" value={effStrokeColor} onChange={(e) => applyText({ strokeColor: e.target.value })} />
            </label>
            <label>
              {t('style.strokeAlpha')} {Math.round(effStrokeAlpha * 100)}%
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effStrokeAlpha * 100)}
                onChange={(e) => applyText({ strokeAlpha: Number(e.target.value) / 100 })}
              />
            </label>
          </>
        )}
        <label>
          {t('style.halo')} {effHalo}px{effHalo === 0 ? t('style.off') : ''}
          <input
            type="range"
            min={0}
            max={40}
            value={effHalo}
            onChange={(e) => applyText({ halo: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          {t('style.glowColor')}
          <input type="color" value={effGlowColor} onChange={(e) => applyText({ glowColor: e.target.value })} />
        </label>
        <label>
          {t('style.bgBoxAlpha')} {Math.round(effTextBgAlpha * 100)}%{effTextBgAlpha === 0 ? t('style.noBgBox') : ''}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(effTextBgAlpha * 100)}
            onChange={(e) => applyText({ textBgAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        {effTextBgAlpha > 0 && (
          <label className="row">
            {t('style.bgBoxColor')}
            <input type="color" value={effTextBgColor} onChange={(e) => applyText({ textBgColor: e.target.value })} />
          </label>
        )}
        <label>
          {t('style.shadowAlpha')} {Math.round(effShadowAlpha * 100)}%{effShadowAlpha === 0 ? t('style.off') : ''}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(effShadowAlpha * 100)}
            onChange={(e) => applyText({ shadowAlpha: Number(e.target.value) / 100 })}
          />
        </label>
        {effShadowAlpha > 0 && (
          <>
            <label className="row">
              {t('style.shadowColor')}
              <input type="color" value={effShadowColor} onChange={(e) => applyText({ shadowColor: e.target.value })} />
            </label>
            <label>
              {t('style.shadowOffset')} {effShadowOffset}px
              <input
                type="range"
                min={0}
                max={20}
                value={effShadowOffset}
                onChange={(e) => applyText({ shadowOffset: Number(e.target.value) })}
              />
            </label>
            <label>
              {t('style.shadowBlur')} {effShadowBlur}px
              <input
                type="range"
                min={0}
                max={30}
                value={effShadowBlur}
                onChange={(e) => applyText({ shadowBlur: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        {textSel && (
          <button className="btn btn-sm" onClick={() => useProject.getState().clearLineOver(selectedIds)}>
            {t('style.restoreDefault')}
          </button>
        )}
        <label className="row">
          {t('style.showMeta')}
          <input type="checkbox" checked={style.showMeta} onChange={(e) => patchStyle({ showMeta: e.target.checked })} />
        </label>
      </ClosableSection>

      <ClosableSection
        windowId="style.transform"
        title={t('style.transformSection')}
        summary={`X${style.globalDx} Y${style.globalDy} ${style.globalRotate}°`}
        defaultOpen={false}
      >
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
      </ClosableSection>

      <ClosableSection
        windowId="style.effects"
        title={`${t('style.effects')}${
          selectedIds.length > 0 ? t('style.effectsSelected', { n: selectedIds.length }) : t('style.effectsGlobal')
        }`}
      >
        <h3 className="effect-group-title">{t('style.effectIn')}</h3>
        <div className="effect-list">
          {inEffectChips.map((fx) => (
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
        <label className="effect-setting">
          <span>{t('style.effectDuration')}</span>
          <input
            type="number"
            min={0}
            step={0.05}
            value={(inDurationMs / 1000).toFixed(2)}
            onChange={(event) => setEffectDuration('in', Number(event.target.value))}
          />
          <span className="hint">{t('style.effectDurationHint')}</span>
        </label>
        {selectedIds.length > 0 && firstSelectedLine?.effectInDurationMs != null && (
          <button className="btn btn-sm" onClick={() => useProject.getState().setLineEffectDuration(selectedIds, 'in', null)}>
            {t('style.durationFollowGlobal')}
          </button>
        )}
        {activeEffectId === 'rise' && (
          <label className="effect-setting">
            <span>
              {t('style.riseHistory')} <strong>{style.riseHistory}</strong>
            </span>
            <input
              type="range"
              min={0}
              max={6}
              step={1}
              value={style.riseHistory}
              onChange={(e) => patchStyle({ riseHistory: Number(e.target.value) })}
            />
            <span className="hint">{t('style.riseHistoryHint')}</span>
          </label>
        )}

        <div className="effect-group-divider" />
        <h3 className="effect-group-title">{t('style.effectOut')}</h3>
        <p className="hint effect-group-hint">{t('style.effectOutTitle')}</p>
        <div className={`effect-list${selectedIds.length === 0 ? ' disabled' : ''}`}>
          <button
            className={`effect-chip${activeOutId === '' ? ' active' : ''}`}
            disabled={selectedIds.length === 0}
            onClick={() => useProject.getState().setLineEffectOut(selectedIds, null)}
          >
            {t('style.effectOutDefault')}
          </button>
          {outEffectChips.map((fx) => (
            <button
              key={fx.id}
              className={`effect-chip${activeOutId === fx.id ? ' active' : ''}${fx.plugin ? ' plugin' : ''}`}
              disabled={selectedIds.length === 0}
              onClick={() => useProject.getState().setLineEffectOut(selectedIds, fx.id)}
              title={fx.plugin ? t('style.pluginEffectTitle') : undefined}
            >
              {fx.name}
              {fx.plugin && <span className="effect-chip-tag">{t('style.pluginTag')}</span>}
            </button>
          ))}
        </div>
        {selectedIds.length === 0 && <p className="hint">{t('style.effectOutSelectHint')}</p>}
        <label className="effect-setting">
          <span>{t('style.effectDuration')}</span>
          <input
            type="number"
            min={0}
            step={0.05}
            value={(outDurationMs / 1000).toFixed(2)}
            onChange={(event) => setEffectDuration('out', Number(event.target.value))}
          />
          <span className="hint">{t('style.effectDurationHint')}</span>
        </label>
        {selectedIds.length > 0 && firstSelectedLine?.effectOutDurationMs != null && (
          <button className="btn btn-sm" onClick={() => useProject.getState().setLineEffectDuration(selectedIds, 'out', null)}>
            {t('style.durationFollowGlobal')}
          </button>
        )}

        <div className="effect-group-divider" />
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
      </ClosableSection>
    </div>
  )
}
