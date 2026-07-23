import { describe, expect, it, beforeEach } from 'vitest'
import { useProject } from './store/project'
import { applyLineEffects, applyLineEffectsOut, applyLineEffectDurations, applyLineStyles, applyTrack, applyTexts, applyStyle, applyPrimaryLrc, importCaptionFile, type CommandLog } from './projectCommand'

const LRC = '[00:01.00]hello\n[00:03.00]world'
const noopLog: CommandLog = () => {}

describe('projectCommand（headless CLI 与命令控制台共用的落地层）', () => {
  beforeEach(() => useProject.getState().loadLrc(LRC, 'x.lrc'))

  describe('applyLineEffects / applyLineStyles（顶层：全局行 id 区间）', () => {
    it('按全局 id 区间设置特效', () => {
      const [a, b] = useProject.getState().lines
      applyLineEffects({ [`${a.id}-${b.id}`]: 'rise' }, noopLog)
      expect(useProject.getState().lines.every((l) => l.effectId === 'rise')).toBe(true)
    })

    it('sets direction-specific exit effects by global id range', () => {
      const [a, b] = useProject.getState().lines
      applyLineEffectsOut({ [`${a.id}-${b.id}`]: 'evaporate-out' }, noopLog)
      expect(useProject.getState().lines.every((line) => line.effectOutId === 'evaporate-out')).toBe(true)
    })

    it('accepts None for both In and Out effects', () => {
      const [line] = useProject.getState().lines
      const logs: string[] = []
      applyLineEffects({ [`${line.id}`]: 'none' }, (message) => logs.push(message))
      applyLineEffectsOut({ [`${line.id}`]: 'none' }, (message) => logs.push(message))
      const updated = useProject.getState().lines.find((item) => item.id === line.id)!
      expect(updated.effectId).toBe('none')
      expect(updated.effectOutId).toBe('none')
      expect(logs).toEqual([])
    })

    it('gives In priority when one command sets both durations', () => {
      const [line] = useProject.getState().lines // 2000 ms segment
      applyLineEffectDurations({ [`${line.id}`]: { in: 1.5, out: 1 } }, noopLog)
      const updated = useProject.getState().lines.find((item) => item.id === line.id)!
      expect([updated.effectInDurationMs, updated.effectOutDurationMs]).toEqual([1500, 500])
    })

    it('无效区间键只警告、不抛错', () => {
      const warnings: string[] = []
      applyLineEffects({ bad: 'rise' }, (m) => warnings.push(m))
      expect(warnings.length).toBe(1)
      expect(useProject.getState().lines.some((l) => l.effectId !== null)).toBe(false)
    })

    it('按全局 id 区间设置文字覆盖', () => {
      const [a] = useProject.getState().lines
      applyLineStyles({ [`${a.id}`]: { fontSize: 120 } }, noopLog)
      expect(useProject.getState().lines.find((l) => l.id === a.id)?.over).toEqual({ fontSize: 120 })
    })
  })

  describe('applyTrack（新增字幕组：位置区间是该组自己的，从 0 数）', () => {
    it('新增字幕组，行按该组自己的位置区间应用特效/样式', () => {
      const track = applyTrack(
        {
          name: 'English',
          lrcText: '[00:01.00]hi\n[00:02.00]there\n[00:03.00]world',
          lrcName: 'en.lrc',
          lineEffects: { '0-1': 'rise' },
          lineEffectsOut: { '1-2': 'dissolve-out' },
          lineStyles: { '2': { fontSize: 60 } }
        },
        noopLog
      )
      expect(track.id).toBe(1)
      expect(track.name).toBe('English')
      const trackLines = useProject
        .getState()
        .lines.filter((l) => l.trackId === track.id)
        .sort((a, b) => a.start - b.start)
      expect(trackLines.map((l) => l.effectId)).toEqual(['rise', 'rise', null])
      expect(trackLines.map((l) => l.effectOutId ?? null)).toEqual([null, 'dissolve-out', 'dissolve-out'])
      expect(trackLines[2].over).toEqual({ fontSize: 60 })
    })

    it('offsetY/visible 缺省时沿用 addTrack 自己的默认错开位置', () => {
      const track = applyTrack({ lrcText: LRC, lrcName: 'x2.lrc', lineEffects: {}, lineStyles: {} }, noopLog)
      const stored = useProject.getState().tracks.find((t) => t.id === track.id)!
      expect(stored.visible).toBe(true)
      expect(stored.offsetY).toBeGreaterThan(0)
    })

    it('显式指定 offsetY/visible 时覆盖默认值', () => {
      const track = applyTrack(
        { lrcText: LRC, lrcName: 'x2.lrc', offsetY: 999, visible: false, lineEffects: {}, lineStyles: {} },
        noopLog
      )
      const stored = useProject.getState().tracks.find((t) => t.id === track.id)!
      expect(stored.offsetY).toBe(999)
      expect(stored.visible).toBe(false)
    })
  })

  describe('applyTexts', () => {
    it('新增独立文字块，套用特效/位置偏移/样式覆盖', () => {
      const before = useProject.getState().lines.length
      applyTexts(
        [{ text: '标题', start: 0.5, end: 5, effect: 'flip', effectOut: 'implode-out', x: 10, y: -20, style: { fontSize: 80 } }],
        noopLog
      )
      const lines = useProject.getState().lines
      expect(lines.length).toBe(before + 1)
      const added = lines.find((l) => l.kind === 'text')!
      expect(added.effectId).toBe('flip')
      expect(added.effectOutId).toBe('implode-out')
      expect(added.dx).toBe(10)
      expect(added.dy).toBe(-20)
      expect(added.over).toEqual({ fontSize: 80 })
    })
  })

  describe('applyStyle', () => {
    it('设置 bgImage 时顺带登记进图片库（不能绕开图片库直接改样式）', () => {
      applyStyle({ bgType: 'image', bgImage: 'D:/bg.jpg' })
      expect(useProject.getState().style.bgImage).toBe('D:/bg.jpg')
      expect(useProject.getState().images.some((i) => i.path === 'D:/bg.jpg')).toBe(true)
    })

    it('非图片字段正常直通 patchStyle', () => {
      applyStyle({ fontSize: 120 })
      expect(useProject.getState().style.fontSize).toBe(120)
    })
  })

  describe('applyPrimaryLrc（控制台专用：非破坏性替换主字幕组）', () => {
    it('替换主字幕组文本，但不影响其它字幕组或撤销历史', () => {
      const track = applyTrack({ lrcText: LRC, lrcName: 'en.lrc', lineEffects: {}, lineStyles: {} }, noopLog)
      const pastBefore = useProject.getState().past.length

      applyPrimaryLrc('[00:05.00]new lyric', 'new.lrc')

      expect(useProject.getState().lrcName).toBe('new.lrc')
      expect(useProject.getState().lines.some((l) => l.text === 'new lyric')).toBe(true)
      expect(useProject.getState().tracks.some((t) => t.id === track.id)).toBe(true)
      expect(useProject.getState().past.length).toBeGreaterThanOrEqual(pastBefore)
    })
  })

  describe('importCaptionFile（顶栏导入歌词）', () => {
    it('replace 只覆盖主字幕，不清空其它字幕组或独立文字', () => {
      const secondary = applyTrack({ lrcText: LRC, lrcName: 'translation.lrc', lineEffects: {}, lineStyles: {} }, noopLog)
      const text = useProject.getState().addLineAt(500, 'text', 'Title')

      expect(importCaptionFile('[00:05.00]replacement', 'replacement.lrc', 'replace')).toBe(0)

      const state = useProject.getState()
      expect(state.lines.filter((line) => line.kind !== 'text' && (line.trackId ?? 0) === 0).map((line) => line.text))
        .toEqual(['replacement'])
      expect(state.lines.some((line) => line.trackId === secondary.id && line.text === 'hello')).toBe(true)
      expect(state.lines.some((line) => line.id === text.id && line.kind === 'text')).toBe(true)
    })

    it('add 保留主字幕并创建以文件名命名的新字幕组', () => {
      const originalPrimary = useProject.getState().lines
        .filter((line) => line.kind !== 'text' && (line.trackId ?? 0) === 0)
        .map((line) => line.text)

      const trackId = importCaptionFile('[00:05.00]translation', 'English.lrc', 'add')
      const state = useProject.getState()

      expect(trackId).toBeGreaterThan(0)
      expect(state.lines.filter((line) => line.kind !== 'text' && (line.trackId ?? 0) === 0).map((line) => line.text))
        .toEqual(originalPrimary)
      expect(state.tracks.find((track) => track.id === trackId)).toMatchObject({ name: 'English', lrcName: 'English.lrc' })
      expect(state.lines.some((line) => line.trackId === trackId && line.text === 'translation')).toBe(true)
    })

    it('空文件不修改当前字幕', () => {
      const before = useProject.getState().lines.map((line) => ({ ...line }))

      expect(importCaptionFile('no timestamps here', 'empty.lrc', 'replace')).toBeNull()
      expect(useProject.getState().lines).toEqual(before)
    })
  })
})
