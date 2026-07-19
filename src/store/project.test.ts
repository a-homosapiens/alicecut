import { describe, expect, it, beforeEach } from 'vitest'
import { useProject } from './project'

const LRC = '[00:01.00]hello\n[00:03.00]world'

describe('撤销 / 重做', () => {
  beforeEach(() => {
    useProject.getState().loadLrc(LRC, 'x.lrc') // 载入会清空历史
  })

  it('载入后历史为空，undo 安全无操作', () => {
    expect(useProject.getState().past.length).toBe(0)
    const before = useProject.getState().lines.length
    useProject.getState().undo()
    expect(useProject.getState().lines.length).toBe(before)
  })

  it('编辑后可 undo 还原、redo 重做', () => {
    const before = useProject.getState().lines.length
    useProject.getState().addLineAt(5000, 'lyric', '新词')
    expect(useProject.getState().lines.length).toBe(before + 1)
    expect(useProject.getState().past.length).toBe(1)

    useProject.getState().undo()
    expect(useProject.getState().lines.length).toBe(before)
    expect(useProject.getState().future.length).toBe(1)

    useProject.getState().redo()
    expect(useProject.getState().lines.length).toBe(before + 1)
  })

  it('新编辑作废 redo 栈', () => {
    useProject.getState().addLineAt(5000, 'text', 'a')
    useProject.getState().undo()
    expect(useProject.getState().future.length).toBe(1)
    useProject.getState().addLineAt(6000, 'text', 'b')
    expect(useProject.getState().future.length).toBe(0) // 新编辑清空 redo
  })
})

describe('行级文字覆盖', () => {
  beforeEach(() => useProject.getState().loadLrc(LRC, 'x.lrc'))

  it('patchLineOver 合并、清键、clearLineOver 复位', () => {
    const id = useProject.getState().lines[0].id
    useProject.getState().patchLineOver([id], { fontSize: 120 })
    expect(useProject.getState().lines[0].over).toEqual({ fontSize: 120 })

    useProject.getState().patchLineOver([id], {
      textColor: '#ff0000',
      strokeWidth: 6,
      halo: 18,
      textBgAlpha: 0.4,
      shadowAlpha: 0.75
    })
    expect(useProject.getState().lines[0].over).toEqual({
      fontSize: 120,
      textColor: '#ff0000',
      strokeWidth: 6,
      halo: 18,
      textBgAlpha: 0.4,
      shadowAlpha: 0.75
    })

    useProject.getState().patchLineOver([id], { fontSize: undefined })
    expect(useProject.getState().lines[0].over).toEqual({
      textColor: '#ff0000',
      strokeWidth: 6,
      halo: 18,
      textBgAlpha: 0.4,
      shadowAlpha: 0.75
    })

    useProject.getState().clearLineOver([id])
    expect(useProject.getState().lines[0].over).toBeUndefined()
  })

  it('只影响选中行', () => {
    const [a, b] = useProject.getState().lines
    useProject.getState().patchLineOver([a.id], { fontSize: 90 })
    expect(useProject.getState().lines.find((l) => l.id === b.id)?.over).toBeUndefined()
  })
})

describe('字幕组（多语言字幕）', () => {
  beforeEach(() => useProject.getState().loadLrc(LRC, 'x.lrc')) // 载入会清空 tracks

  it('addTrack 铸造递增 id（从 1 开始，0 是主字幕组不进这个数组）', () => {
    const t1 = useProject.getState().addTrack('English')
    expect(t1.id).toBe(1)
    expect(t1.name).toBe('English')
    const t2 = useProject.getState().addTrack('Pinyin')
    expect(t2.id).toBe(2)
    expect(useProject.getState().tracks.map((t) => t.id)).toEqual([1, 2])
  })

  it('loadLrcToTrack 只替换该组自己的行，不影响主字幕组/其它组/独立文字块', () => {
    const primaryBefore = useProject.getState().lines.length
    useProject.getState().addLineAt(500, 'text', '标题') // 独立文字块，trackId 缺省
    const track = useProject.getState().addTrack('English')
    useProject.getState().loadLrcToTrack(track.id, '[00:01.00]hi\n[00:02.00]there\n[00:03.00]world', 'en.lrc')

    let lines = useProject.getState().lines
    expect(lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === 0).length).toBe(primaryBefore)
    expect(lines.filter((l) => l.trackId === track.id).length).toBe(3)
    expect(lines.some((l) => l.kind === 'text')).toBe(true) // 文字块还在

    // 再次导入替换：旧的 3 行消失换成新的 2 行，主字幕组/文字块仍不受影响
    useProject.getState().loadLrcToTrack(track.id, '[00:01.00]a\n[00:02.00]b', 'en2.lrc')
    lines = useProject.getState().lines
    expect(lines.filter((l) => l.trackId === track.id).length).toBe(2)
    expect(lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === 0).length).toBe(primaryBefore)
    expect(lines.some((l) => l.kind === 'text')).toBe(true)
  })

  it('loadLrcToTrack(0, …) 非破坏性地替换主字幕组，不清空撤销历史（与 loadLrc 相反）', () => {
    useProject.getState().addLineAt(500, 'text', '标题')
    const textId = useProject.getState().lines.find((l) => l.kind === 'text')!.id

    useProject.getState().loadLrcToTrack(0, '[00:05.00]new lyric', 'new.lrc')

    expect(useProject.getState().lines.find((l) => l.id === textId)).toBeDefined() // 文字块没被误删
    expect(useProject.getState().lrcName).toBe('new.lrc')
    expect(useProject.getState().past.length).toBeGreaterThan(0) // 未清空撤销历史
  })

  it('行 id 全局唯一，跨字幕组不冲突', () => {
    const track = useProject.getState().addTrack()
    useProject.getState().loadLrcToTrack(track.id, LRC, 'x2.lrc')
    const ids = useProject.getState().lines.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('removeTrack 删除该组全部行；主字幕组（0）不可删除', () => {
    const before = useProject.getState().lines.length
    const track = useProject.getState().addTrack()
    useProject.getState().loadLrcToTrack(track.id, LRC, 'x2.lrc')
    expect(useProject.getState().lines.length).toBe(before + 2)

    useProject.getState().removeTrack(track.id)
    expect(useProject.getState().lines.length).toBe(before)
    expect(useProject.getState().tracks.length).toBe(0)

    useProject.getState().removeTrack(0) // 无效果
    expect(useProject.getState().lines.length).toBe(before)
  })

  it('repaginate 按字幕组隔离，不会把两组的词混流合并', () => {
    const track = useProject.getState().addTrack()
    useProject.getState().loadLrcToTrack(track.id, LRC, 'x2.lrc')
    const primaryBefore = useProject.getState().lines.filter((l) => (l.trackId ?? 0) === 0)

    useProject.getState().repaginate(track.id, 5000) // 阈值够大，该组两行合并成一页

    const after = useProject.getState().lines
    expect(after.filter((l) => (l.trackId ?? 0) === 0)).toEqual(primaryBefore) // 主字幕组原样不动
    const trackLines = after.filter((l) => l.trackId === track.id)
    expect(trackLines.length).toBe(1)
    expect(trackLines[0].text).toBe('helloworld') // 两行的词合并进了同一页，而不是各自打散重排
  })

  it('setTrackOffsetY / setTrackVisible / renameTrack 只影响目标字幕组，对 id 0 无效果', () => {
    const track = useProject.getState().addTrack()
    useProject.getState().setTrackOffsetY(track.id, 300)
    useProject.getState().setTrackVisible(track.id, false)
    useProject.getState().renameTrack(track.id, '日语')
    const updated = useProject.getState().tracks.find((t) => t.id === track.id)!
    expect(updated.offsetY).toBe(300)
    expect(updated.visible).toBe(false)
    expect(updated.name).toBe('日语')

    useProject.getState().setTrackOffsetY(0, 999)
    useProject.getState().setTrackVisible(0, false)
    expect(useProject.getState().tracks).toEqual([updated]) // 没有产生 id 0 的记录
  })
})

describe('图片库', () => {
  // loadLrc 故意不清空 images（图片与歌词内容无关，见下方专门用例验证）——所以这里全部用相对
  // 增量断言 + 各用例专属的独一路径，不假设"进用例时图片库是空的"；用一个原始 setState 去强清
  // images 反而更糟：那本身是一次不经 historySuspend 的变更，会被撤销历史的合并窗口与紧随其后
  // 的第一步操作错误地合并成一步，undo 效果验证不出来（曾踩过这个坑）
  beforeEach(() => useProject.getState().loadLrc(LRC, 'x.lrc'))

  it('addImage 按路径去重，重复导入返回同一条记录', () => {
    const before = useProject.getState().images.length
    const a = useProject.getState().addImage('D:/dedupe-test.jpg', 'bg.jpg')
    const b = useProject.getState().addImage('D:/dedupe-test.jpg', 'bg-renamed.jpg')
    expect(b).toEqual(a)
    expect(useProject.getState().images.length).toBe(before + 1)
  })

  it('hydrate 载入已有图片后新增的图片不与之撞 id（回归：模块级计数器会在这里撞车）', () => {
    useProject.getState().hydrate({
      meta: { offset: 0 },
      lines: [],
      style: useProject.getState().style,
      lrcName: null,
      images: [{ id: 5, path: 'D:/old.jpg', name: 'old.jpg' }]
    })
    const added = useProject.getState().addImage('D:/new.jpg', 'new.jpg')
    expect(added.id).toBe(6)
    expect(useProject.getState().images.map((i) => i.id)).toEqual([5, 6])
  })

  it('removeImage 只在移除的是当前背景图时才清空 bgImage', () => {
    const before = useProject.getState().images.length
    const a = useProject.getState().addImage('D:/remove-test-a.jpg', 'a.jpg')
    const b = useProject.getState().addImage('D:/remove-test-b.jpg', 'b.jpg')
    useProject.getState().patchStyle({ bgType: 'image', bgImage: a.path })

    useProject.getState().removeImage(b.id) // 不是当前背景图
    expect(useProject.getState().style.bgImage).toBe(a.path)
    expect(useProject.getState().images.length).toBe(before + 1)

    useProject.getState().removeImage(a.id) // 正是当前背景图
    expect(useProject.getState().style.bgImage).toBeNull()
    expect(useProject.getState().images.length).toBe(before)
  })

  it('loadLrc 不清空图片库（图片与歌词内容无关，不因换歌而作废）', () => {
    const before = useProject.getState().images.length
    useProject.getState().addImage('D:/survive-loadlrc.jpg', 'bg.jpg')
    useProject.getState().loadLrc(LRC, 'y.lrc')
    expect(useProject.getState().images.length).toBe(before + 1)
  })

  it('addImage/removeImage 可撤销/重做', () => {
    const before = useProject.getState().images.length
    useProject.getState().addImage('D:/undo-test.jpg', 'bg.jpg')
    expect(useProject.getState().images.length).toBe(before + 1)
    expect(useProject.getState().past.length).toBeGreaterThan(0)

    useProject.getState().undo()
    expect(useProject.getState().images.length).toBe(before)

    useProject.getState().redo()
    expect(useProject.getState().images.length).toBe(before + 1)
  })
})
