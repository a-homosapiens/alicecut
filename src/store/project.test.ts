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

    useProject.getState().patchLineOver([id], { textColor: '#ff0000' })
    expect(useProject.getState().lines[0].over).toEqual({ fontSize: 120, textColor: '#ff0000' })

    useProject.getState().patchLineOver([id], { fontSize: undefined })
    expect(useProject.getState().lines[0].over).toEqual({ textColor: '#ff0000' })

    useProject.getState().clearLineOver([id])
    expect(useProject.getState().lines[0].over).toBeUndefined()
  })

  it('只影响选中行', () => {
    const [a, b] = useProject.getState().lines
    useProject.getState().patchLineOver([a.id], { fontSize: 90 })
    expect(useProject.getState().lines.find((l) => l.id === b.id)?.over).toBeUndefined()
  })
})
