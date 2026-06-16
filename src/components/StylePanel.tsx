import { useEffect, useState } from 'react'
import { useProject, RESOLUTIONS, type AspectId } from '../store/project'
import { EFFECTS } from '../core/effects'
import { SYSTEM_FONTS, loadBuiltinFonts, registerImportedFont, type FontOption } from '../fonts'
import { invalidateLayoutCache } from '../core/render'

export function StylePanel(): React.JSX.Element {
  const style = useProject((s) => s.style)
  const patchStyle = useProject((s) => s.patchStyle)
  const selectedIds = useProject((s) => s.selectedIds)
  const lines = useProject((s) => s.lines)
  const [fonts, setFonts] = useState<FontOption[]>(SYSTEM_FONTS)

  // 选中线段时特效作用于选中项：全部同一特效则高亮它，混合则都不高亮
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

  return (
    <div className="style-panel">
      <section>
        <h3>画面</h3>
        <label>
          尺寸
          <select value={style.aspect} onChange={(e) => patchStyle({ aspect: e.target.value as AspectId })}>
            {(Object.keys(RESOLUTIONS) as AspectId[]).map((id) => (
              <option key={id} value={id}>
                {RESOLUTIONS[id].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          背景
          <select
            value={style.bgType}
            onChange={(e) => patchStyle({ bgType: e.target.value as 'solid' | 'gradient' })}
          >
            <option value="solid">纯色</option>
            <option value="gradient">渐变</option>
          </select>
        </label>
        <label className="row">
          {style.bgType === 'solid' ? '颜色' : '渐变起点'}
          <input type="color" value={style.bgFrom} onChange={(e) => patchStyle({ bgFrom: e.target.value })} />
        </label>
        {style.bgType === 'gradient' && (
          <>
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
      </section>

      <section>
        <h3>文字</h3>
        <label>
          字体
          <select value={style.fontFamily} onChange={(e) => patchStyle({ fontFamily: e.target.value })}>
            {fonts.map((f) => (
              <option key={f.family} value={f.family}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-sm" onClick={importFont}>
          导入字体文件…
        </button>
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
          <input
            type="checkbox"
            checked={style.italic}
            onChange={(e) => patchStyle({ italic: e.target.checked })}
          />
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
          <input
            type="checkbox"
            checked={style.showMeta}
            onChange={(e) => patchStyle({ showMeta: e.target.checked })}
          />
        </label>
      </section>

      <section>
        <h3>字幕底色与描影</h3>
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
            <input
              type="color"
              value={style.textBgColor}
              onChange={(e) => patchStyle({ textBgColor: e.target.value })}
            />
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
              <input
                type="color"
                value={style.shadowColor}
                onChange={(e) => patchStyle({ shadowColor: e.target.value })}
              />
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
      </section>

      <section>
        <h3>特效{selectedIds.length > 0 ? `（应用到选中的 ${selectedIds.length} 条）` : '（全局默认）'}</h3>
        <div className="effect-list">
          {EFFECTS.map((fx) => (
            <button
              key={fx.id}
              className={`effect-chip${activeEffectId === fx.id ? ' active' : ''}`}
              onClick={() => chooseEffect(fx.id)}
            >
              {fx.name}
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => useProject.getState().setLineEffect(selectedIds, null)}
          >
            恢复跟随全局默认
          </button>
        )}
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
      </section>
    </div>
  )
}
